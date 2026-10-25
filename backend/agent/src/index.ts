/**
 * Autonomous budgeted agent.
 *
 * Give it a goal in plain English and a USDC budget. It:
 *   1. asks the AXIS router which workflows exist,
 *   2. uses an LLM (NVIDIA NIM) to pick a workflow and fill its inputs,
 *   3. quotes it (zero payment) and checks the budget,
 *   4. pays ONLY if it's within budget and the spend policy allows it,
 *   5. summarises the providers' results.
 *
 * The budget is enforced in TWO places: the agent declines a quote over budget,
 * and the router's Spend Policy Guard is the hard backstop — a FAIL there means
 * nothing is ever signed. So even a misbehaving agent cannot overspend.
 *
 * Zero dependencies: it uses @axis/pay for money and NIM's OpenAI-compatible
 * HTTP API for reasoning. Env is loaded with node's built-in loadEnvFile.
 */
import { createAxisClient, AxisPayError, type Receipt, type WorkflowInfo } from "axis-pay";

export interface AgentOptions {
  goal: string;
  budgetUSDC: number;
  routerUrl?: string;
  agentAddress?: string;
  nim?: { apiKey: string; baseUrl?: string; model?: string };
  log?: (line: string) => void;
}

export interface AgentOutcome {
  decision: { workflow: string; inputs: Record<string, unknown> };
  quotedUSDC: string;
  paid: boolean;
  reason?: string;         // why it did NOT pay, if it didn't
  receipt?: Receipt;
  summary?: string;
}

const DEFAULT_NIM = { baseUrl: "https://integrate.api.nvidia.com/v1", model: "meta/llama-3.1-8b-instruct" };

/** One NIM chat call (OpenAI-compatible). */
async function chat(nim: NonNullable<AgentOptions["nim"]>, system: string, user: string): Promise<string> {
  const res = await fetch(`${nim.baseUrl ?? DEFAULT_NIM.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${nim.apiKey}` },
    body: JSON.stringify({
      model: nim.model ?? DEFAULT_NIM.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.2, max_tokens: 500,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`NIM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

/** Pull the first JSON object out of an LLM reply, tolerating prose around it. */
function extractJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
}

/** Ask the LLM to choose a workflow and fill its required inputs from the goal. */
async function decide(nim: AgentOptions["nim"], goal: string, workflows: WorkflowInfo[]): Promise<AgentOutcome["decision"]> {
  const catalogue = workflows.map((w) => `- ${w.id} (inputs: ${w.inputs.join(", ")})`).join("\n");
  const first = workflows[0];
  if (!first) throw new Error("router advertises no workflows");

  if (!nim?.apiKey) {
    // No LLM configured — fall back to the only/first workflow, goal → every input.
    return { workflow: first.id, inputs: Object.fromEntries(first.inputs.map((k) => [k, goal])) };
  }
  const reply = await chat(nim,
    "You are an autonomous purchasing agent. You may spend money ONLY on a workflow that genuinely accomplishes the goal. " +
    "Each workflow does one specific job — e.g. 'pr-review' reviews a code change / diff; it does NOT generate images or answer general questions. " +
    "Reply with ONLY JSON. If a workflow fits: {\"workflow\": <id>, \"inputs\": {<required keys as strings>}}. " +
    "If NO workflow fits: {\"workflow\": null, \"reason\": \"<one short sentence>\"}.",
    `Goal: ${goal}\n\nAvailable workflows:\n${catalogue}`,
  );
  const parsed = extractJson(reply);
  const chosen = workflows.find((w) => w.id === parsed?.workflow);
  if (!chosen) {
    const reason = typeof parsed?.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : "no available service can do this task";
    throw new AxisPayError("NO_SUITABLE_SERVICE", `Can't do this: ${reason}`);
  }
  const rawInputs = (parsed?.inputs as Record<string, unknown>) ?? {};
  const inputs = Object.fromEntries(chosen.inputs.map((k) => [k, String(rawInputs[k] ?? goal)]));
  return { workflow: chosen.id, inputs };
}

export async function runAutonomousAgent(opts: AgentOptions): Promise<AgentOutcome> {
  const log = opts.log ?? (() => {});
  const axis = createAxisClient({ routerUrl: opts.routerUrl ?? "http://localhost:8080" });
  const agentAddress = opts.agentAddress ?? "NG5SZZ3U6XOB4L5N4CPZ7SLIZRDIEK2CM4XMB5WDPLAWSCIRCIJTTKYOPQ";

  log(`🤖 goal: ${opts.goal}`);
  log(`💰 budget: $${opts.budgetUSDC.toFixed(2)}`);

  const workflows = await axis.listWorkflows();
  let decision: { workflow: string; inputs: Record<string, unknown> };
  try {
    decision = await decide(opts.nim, opts.goal, workflows);
  } catch (e) {
    // No service fits the goal — refuse, pay nothing.
    const reason = e instanceof AxisPayError ? e.message : (e as Error).message;
    log(`🛑 ${reason}`);
    return { decision: { workflow: "none", inputs: {} }, quotedUSDC: "0", paid: false, reason };
  }
  log(`🧠 chose workflow "${decision.workflow}" with inputs: ${Object.keys(decision.inputs).join(", ")}`);

  const quote = await axis.quote(decision.workflow, decision.inputs, agentAddress);
  log(`🧾 quote: $${quote.totalUSDC}  ·  spend policy: ${quote.policy.verdict}`);

  // Layer 1 — the agent's own budget discipline.
  if (Number(quote.totalUSDC) > opts.budgetUSDC) {
    const reason = `quote $${quote.totalUSDC} exceeds budget $${opts.budgetUSDC.toFixed(2)} — declining`;
    log(`🛑 ${reason}`);
    return { decision, quotedUSDC: quote.totalUSDC, paid: false, reason };
  }
  // Layer 2 — the router's guard would block a FAIL before any signature anyway.
  if (quote.policy.verdict === "FAIL") {
    const reason = `spend policy blocked: ${quote.policy.violations[0] ?? "policy violation"}`;
    log(`🛑 ${reason}`);
    return { decision, quotedUSDC: quote.totalUSDC, paid: false, reason };
  }

  log(`✅ within budget — paying atomically…`);
  let receipt: Receipt;
  try {
    receipt = await axis.pay(decision.workflow, decision.inputs, agentAddress, { budgetUSDC: opts.budgetUSDC });
  } catch (e) {
    const err = e as AxisPayError;
    log(`🛑 payment refused (${err.code}): ${err.message}`);
    return { decision, quotedUSDC: quote.totalUSDC, paid: false, reason: `${err.code}: ${err.message}` };
  }
  log(`💸 ${receipt.status} — $${receipt.totalUSDC} across ${receipt.legs.length} providers (round ${receipt.confirmedRound})`);
  for (const l of receipt.legs) log(`   ${l.provider}: ${l.status}`);

  // Summarise the paid results back to the user.
  let summary: string | undefined;
  if (opts.nim?.apiKey) {
    const material = receipt.legs
      .filter((l) => l.result != null)
      .map((l) => `${l.provider}: ${typeof l.result === "string" ? l.result : JSON.stringify(l.result)}`)
      .join("\n");
    summary = await chat(opts.nim,
      "You are a concise assistant. Summarise these paid API results into a short answer to the user's goal.",
      `Goal: ${opts.goal}\n\nResults:\n${material}`).catch(() => undefined);
    if (summary) log(`\n📝 ${summary}`);
  }

  return { decision, quotedUSDC: quote.totalUSDC, paid: true, receipt, summary };
}
