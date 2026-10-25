import { eq } from "drizzle-orm";
/**
 * Autonomous agent, in-process.
 *
 * Powers POST /v1/agent/run: an LLM (NVIDIA NIM) picks a workflow and fills its
 * inputs from a plain-English goal, then the run goes through the SAME quote →
 * guard → execute path as everything else, streaming on one runId. The budget
 * is enforced twice: as the quote's client ceiling (the guard fails a FAIL
 * before any signature) and as an explicit decline here. Nothing new touches
 * the money path — this only chooses inputs and calls the existing engine.
 */
import { buildQuote, persistQuote } from "./quote.ts";
import { execute } from "./execute.ts";
import { projectHeadroomMicro } from "./receipt.ts";
import { db } from "../db/client.ts";
import { runs } from "../db/schema.ts";
import { WORKFLOWS, type WorkflowDef } from "../workflows/pr-review.ts";
import { agentAccount } from "../chain/client.ts";
import { emit } from "../bus.ts";
import { formatUSDC } from "@axis/shared";
import type { Config } from "../config.ts";

const DEFAULT_NIM = { baseUrl: "https://integrate.api.nvidia.com/v1", model: "meta/llama-3.1-8b-instruct" };

/** Required `${inputs.x}` names for a workflow. */
function requiredInputs(w: WorkflowDef): string[] {
  const set = new Set<string>();
  for (const s of w.steps) {
    for (const t of Object.values(s.input)) {
      if (typeof t === "string") {
        for (const m of t.matchAll(/\$\{\s*inputs\.([A-Za-z0-9_]+)\s*\}/g)) set.add(m[1]!);
      }
    }
  }
  return [...set];
}

async function nimChat(cfg: Config, system: string, user: string): Promise<string> {
  const res = await fetch(`${cfg.NVIDIA_BASE_URL ?? DEFAULT_NIM.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.NVIDIA_API_KEY}` },
    body: JSON.stringify({
      model: cfg.NVIDIA_MODEL ?? DEFAULT_NIM.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.2, max_tokens: 500,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`NIM ${res.status}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

function extractJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
}

type Decision =
  | { workflow: WorkflowDef; inputs: Record<string, unknown> }
  | { reject: string };

/**
 * Choose a workflow that GENUINELY fits the goal, or reject. This is the honesty
 * gate: the agent must refuse a task no available service can do (e.g. "create
 * an image" when the only service reviews code) rather than pay for nonsense.
 */
async function decide(cfg: Config, goal: string): Promise<Decision> {
  const workflows = Object.values(WORKFLOWS);
  const first = workflows[0]!;
  const fill = (w: WorkflowDef, raw: Record<string, unknown> = {}) =>
    Object.fromEntries(requiredInputs(w).map((k) => [k, String(raw[k] ?? goal)]));

  // No LLM configured — we cannot judge relevance, so run the only workflow.
  if (!cfg.NVIDIA_API_KEY) return { workflow: first, inputs: fill(first) };

  const catalogue = workflows.map((w) => `- ${w.id} (inputs: ${requiredInputs(w).join(", ")})`).join("\n");
  const reply = await nimChat(cfg,
    "You are an autonomous purchasing agent. You may spend money ONLY on a workflow that genuinely accomplishes the user's goal. " +
    "Each workflow does one specific job — e.g. 'pr-review' reviews a code change / diff; it does NOT generate images, answer general questions, or do anything else. " +
    "Reply with ONLY JSON. If a workflow truly fits, reply {\"workflow\": <id>, \"inputs\": {<the required keys, as strings>}}. " +
    "If NO workflow fits the goal, reply {\"workflow\": null, \"reason\": \"<one short sentence saying no service can do this>\"}.",
    `Goal: ${goal}\n\nAvailable workflows:\n${catalogue}`,
  ).catch(() => "");
  const parsed = extractJson(reply);
  const chosen = workflows.find((w) => w.id === parsed?.workflow);
  if (!chosen) {
    const reason = typeof parsed?.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim()
      : "no available service can do this task";
    return { reject: reason };
  }
  return { workflow: chosen, inputs: fill(chosen, (parsed?.inputs as Record<string, unknown>) ?? {}) };
}

/**
 * Run the agent on a pre-minted runId. Fire-and-forget: it emits events on that
 * runId so the console (and the extension, via /v1/runs/latest) animate it live.
 *
 * Budget is automatic, not typed in: when the run is tagged to a project with
 * its own budget, the ceiling is whatever headroom that project has left
 * (budget minus what it has already spent). No project, or a project with no
 * budget set, means no client ceiling at all — the server's spend-policy
 * limits (per-workflow, per-provider, hourly, velocity) are the backstop, the
 * same as they are for every other run. An explicit `budgetUSDC` still wins
 * when given, for callers (MCP, scripts) that want their own hard cap.
 */
/**
 * Record a run that ended without spending anything — a refusal, a policy
 * block, an internal error. These used to leave no trace at all, so the
 * console showed nothing and a correct refusal was indistinguishable from a
 * broken integration. A run that cost $0 is still a run; the ledger should
 * say "asked, declined, paid nothing" rather than stay silent.
 */
async function recordZeroCostRun(
  cfg: Config, runId: string, agentAddress: string,
  what: { workflow: string; code: string; message: string; projectId?: string; apiKey?: string },
): Promise<void> {
  try {
    await db(cfg.DATABASE_URL).insert(runs).values({
      id: runId,
      quoteId: null,                       // never got as far as a quote
      workflow: what.workflow,
      agentAddress,
      status: "FAILED",
      projectId: what.projectId ?? null,
      apiKey: what.apiKey ?? null,
      totalMicro: 0n,
      refundedMicro: 0n,
      error: { code: what.code, message: what.message, costedNothing: true },
      finishedAt: new Date(),
    });
  } catch { /* the ledger entry is best-effort; never mask the real outcome */ }
}

export async function runAgentInline(runId: string, goal: string, cfg: Config, projectId?: string, apiKey?: string, budgetUSDC?: number): Promise<void> {
  const agentAddrForRecord = String(agentAccount(cfg).agent.addr);
  try {
    const agentAddr = String(agentAccount(cfg).agent.addr);
    const decision = await decide(cfg, goal);

    // Honesty gate: no service fits the goal → refuse, pay NOTHING.
    if ("reject" in decision) {
      const message = `Can't do this: ${decision.reject}`;
      await recordZeroCostRun(cfg, runId, agentAddr, {
        workflow: "refused", code: "NO_SUITABLE_SERVICE", message, projectId, apiKey,
      });
      emit(runId, { type: "run.error", code: "NO_SUITABLE_SERVICE", message, costedNothing: true });
      emit(runId, { type: "run.completed", status: "FAILED", receiptId: runId, totalUSDC: "0.00", refundedUSDC: "0.00", durationMs: 0 });
      return;
    }
    const { workflow, inputs } = decision;
    const projectBudget = projectId ? await projectHeadroomMicro(cfg.DATABASE_URL, projectId) ?? undefined : undefined;
    const clientBudget = budgetUSDC != null ? BigInt(Math.round(budgetUSDC * 1e6)) : undefined;
    const budgetMicro = clientBudget == null ? projectBudget : projectBudget == null ? clientBudget
      : clientBudget < projectBudget ? clientBudget : projectBudget;

    // Quote through the normal engine — emits run.started + probes + policy on runId.
    const quote = await buildQuote(workflow, agentAddr, inputs, cfg, runId, budgetMicro);
    await persistQuote(quote, inputs, cfg.DATABASE_URL, apiKey, runId);

    if (quote.policy.verdict === "FAIL" || (budgetMicro != null && quote.totalMicro > budgetMicro)) {
      const message = quote.policy.violations[0] ??
        `quote $${formatUSDC(quote.totalMicro)} exceeds the project's remaining budget ($${formatUSDC(budgetMicro ?? 0n)})`;
      await recordZeroCostRun(cfg, runId, agentAddr, {
        workflow: workflow.id, code: "POLICY_VIOLATION", message, projectId, apiKey,
      });
      emit(runId, { type: "run.error", code: "POLICY_VIOLATION", message, costedNothing: true });
      emit(runId, { type: "run.completed", status: "FAILED", receiptId: runId, totalUSDC: "0.00", refundedUSDC: "0.00", durationMs: 0 });
      return;
    }

    // Within budget and policy — settle atomically via the normal execute path.
    try { await execute(quote.quoteId, cfg, runId, undefined, projectId, apiKey); } catch (error) {
      const existing = await db(cfg.DATABASE_URL).select({ id: runs.id }).from(runs).where(eq(runs.id, runId));
      if (existing.length) return;
      throw error;
    }
  } catch (e) {
    await recordZeroCostRun(cfg, runId, agentAddrForRecord, {
      workflow: "failed", code: "INTERNAL", message: (e as Error).message, projectId, apiKey,
    });
    emit(runId, { type: "run.error", code: "INTERNAL", message: (e as Error).message, costedNothing: true });
    emit(runId, { type: "run.completed", status: "FAILED", receiptId: runId, totalUSDC: "0.00", refundedUSDC: "0.00", durationMs: 0 });
  }
}
