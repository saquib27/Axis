/**
 * @axis/pay — the drop-in client for atomic multi-provider x402 payments.
 *
 * One import, four calls. An agent describes a workflow; AXIS discovers each
 * provider's x402 price, composes ONE atomic Algorand group, settles it with a
 * single signature, and returns a unified receipt. Either every provider is
 * paid and every result comes back, or nothing settles and the agent is out $0.
 *
 * Zero dependencies: it talks HTTP to an AXIS router and nothing else, so it
 * runs in any Node 18+ / edge runtime with global `fetch`. The router holds the
 * agent wallet and does the signing, so this SDK never touches a key.
 *
 *   import { createAxisClient } from "@axis/pay";
 *   const axis = createAxisClient({ routerUrl: "http://localhost:8080" });
 *   const receipt = await axis.pay("pr-review",
 *     { diff, commitMessage }, agentAddress, { budgetUSDC: 0.5 });
 */

export interface AxisClientOptions {
  /** Base URL of the AXIS router, e.g. "http://localhost:8080". */
  routerUrl: string;
  /** Optional bearer token (from /v1/auth/login) for gated deployments. */
  token?: string;
  /** Account API key (Console → Projects page → "copy"). Scopes
   *  every call to your account — your projects, your runs, your live
   *  stream — so runs made through this client show up in your console and
   *  the Chrome extension in real time. */
  apiKey?: string;
  /** Per-request timeout in ms (default 90_000 — a full settle can take ~15s). */
  timeoutMs?: number;
}

export interface QuoteLeg { stepId: string; provider: string; payTo: string; priceUSDC: string; asset: string }
export interface PolicyVerdict { verdict: "PASS" | "FAIL"; violations: string[]; checks: unknown[] }

export interface Quote {
  runId: string;
  quoteId: string;
  workflow: string;
  network: string;
  legs: QuoteLeg[];
  subtotalUSDC: string;
  routingFeeUSDC: string;
  totalUSDC: string;
  expiresAt: string;
  policy: PolicyVerdict;
  signature: string;
}

export interface ReceiptLeg {
  stepId: string; provider: string; payTo: string; priceUSDC: string;
  txid: string; explorerUrl: string; status: string; result?: unknown;
  compensationTxid?: string; compensationExplorerUrl?: string; latencyMs?: number;
}
export interface Receipt {
  receiptId: string;
  workflow: string;
  status: "SETTLED" | "PARTIAL" | "REVERSED" | "FAILED";
  groupId: string;
  confirmedRound?: number;
  agentAddress: string;
  signatureCount: 1;
  legs: ReceiptLeg[];
  totalUSDC: string;
  refundedUSDC: string;
  createdAt: string;
}

export interface PayOptions {
  /** Hard ceiling — pay() throws OVER_BUDGET before settling if the quote exceeds it. */
  budgetUSDC?: number;
  /** Tag this run to a project (group runs + see per-project spend). */
  projectId?: string;
  /** Demo only: force a named step to fail after payment, to exercise compensation. */
  chaosStep?: string;
}

export interface AgentRunOptions {
  /** Hard ceiling in USDC. Omit it when `projectId` points at a budgeted
   *  project — the ceiling is then automatic: whatever headroom that
   *  project has left. With no project, or a project with no budget, the
   *  server's own spend-policy limits are still enforced either way. */
  budgetUSDC?: number;
  /** Tag this run to a project — also how it gets an automatic budget. */
  projectId?: string;
}

export interface ProjectSummary {
  id: string; name: string; createdAt: string;
  runs: number; grossUSDC: string; refundedUSDC: string; netUSDC: string;
  /** Total budget for this project, or null if it has none of its own. */
  budgetUSDC: string | null;
  /** Headroom left under that budget, or null when there is no budget. */
  remainingUSDC: string | null;
}

/** Typed error carrying the router's own error code. */
export class AxisPayError extends Error {
  readonly code: string;
  readonly costedNothing: boolean;
  constructor(code: string, message: string, costedNothing = true) {
    super(message);
    this.name = "AxisPayError";
    this.code = code;
    this.costedNothing = costedNothing;
  }
}

export interface WorkflowInfo {
  id: string;
  steps: { id: string; provider: string; path: string }[];
  inputs: string[];
}

export interface Account { id: string; email: string }

export interface AxisClient {
  /** Whose account is this client acting as? Answer before spending. */
  whoami(): Promise<Account>;
  /** The workflows an agent can run (id, provider steps, required inputs). */
  listWorkflows(): Promise<WorkflowInfo[]>;
  /** Price a workflow with ZERO payment. Returns the signed quote (incl. policy). */
  quote(workflow: string, inputs: Record<string, unknown>, agentAddress: string): Promise<Quote>;
  /** Quote → budget check → settle → receipt. The one call an agent needs. */
  pay(workflow: string, inputs: Record<string, unknown>, agentAddress: string, opts?: PayOptions): Promise<Receipt>;
  /** Describe a task in plain English; an LLM picks the workflow and pays it —
   *  or refuses and spends nothing if no available service fits. Runs in the
   *  background on the router; returns immediately with a runId to follow via
   *  `onEvents` or `getReceipt`. */
  runAgent(goal: string, opts?: AgentRunOptions): Promise<{ runId: string }>;
  /** Fetch a receipt by run id — renders standalone, hours later. */
  getReceipt(runId: string): Promise<Receipt>;
  /** Subscribe to the live event stream for a run (needs global EventSource). */
  onEvents(runId: string, cb: (event: Record<string, unknown>) => void): () => void;
  /** List projects with their rolled-up spend. */
  listProjects(): Promise<ProjectSummary[]>;
  /** Create a project to group runs under; returns it (pass its id as PayOptions.projectId). */
  createProject(name: string, budgetUSDC?: number): Promise<ProjectSummary>;
}

export function createAxisClient(options: AxisClientOptions): AxisClient {
  const base = options.routerUrl.replace(/\/$/, "");
  const timeout = options.timeoutMs ?? 90_000;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  // Scopes every call — GET and POST alike — to this account, so runs made
  // through this client show up live in the console and the extension.
  if (options.apiKey) headers["x-api-key"] = options.apiKey;

  async function req<T>(path: string, body: unknown): Promise<{ status: number; json: any }> {
    const res = await fetch(`${base}${path}`, {
      method: "POST", headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  /** GET + surface the router's own error code/message, not just a status. */
  async function getJson(path: string, fallbackCode: string): Promise<any> {
    const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(timeout) });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      throw new AxisPayError(json?.error?.code ?? fallbackCode, json?.error?.message ?? `request failed (${res.status})`);
    }
    return json;
  }

  async function whoami(): Promise<Account> {
    return (await getJson("/v1/me", "NO_ACCOUNT")) as Account;
  }

  async function listWorkflows(): Promise<WorkflowInfo[]> {
    return (await getJson("/v1/workflows", "WORKFLOWS_FAILED")).workflows ?? [];
  }

  async function quote(workflow: string, inputs: Record<string, unknown>, agentAddress: string): Promise<Quote> {
    const { json } = await req("/v1/workflow/quote", { workflow, agentAddress, inputs });
    // A 402 policy-block still returns a full quote body (with a FAIL verdict);
    // any response carrying quoteId is a valid quote we hand back for inspection.
    if (json && json.quoteId) return json as Quote;
    throw new AxisPayError(json?.error?.code ?? "QUOTE_FAILED", json?.error?.message ?? "quote failed");
  }

  async function getReceipt(runId: string): Promise<Receipt> {
    return (await getJson(`/v1/receipt/${runId}`, "RECEIPT_NOT_FOUND")) as Receipt;
  }

  async function pay(workflow: string, inputs: Record<string, unknown>, agentAddress: string, opts: PayOptions = {}): Promise<Receipt> {
    const q = await quote(workflow, inputs, agentAddress);
    if (q.policy?.verdict === "FAIL") {
      throw new AxisPayError("POLICY_BLOCKED", q.policy.violations?.[0] ?? "spend policy rejected this workflow");
    }
    if (opts.budgetUSDC != null && Number(q.totalUSDC) > opts.budgetUSDC) {
      throw new AxisPayError("OVER_BUDGET", `quote $${q.totalUSDC} exceeds budget $${opts.budgetUSDC}`);
    }
    const body: Record<string, unknown> = { quoteId: q.quoteId, runId: q.runId };
    if (opts.chaosStep) body.chaos = opts.chaosStep;
    if (opts.projectId) body.projectId = opts.projectId;
    const { status, json } = await req("/v1/workflow/execute", body);
    if (status >= 400 || json?.error) {
      throw new AxisPayError(json?.error?.code ?? "EXECUTE_FAILED", json?.error?.message ?? `execute failed (${status})`, json?.error?.costedNothing ?? false);
    }
    // execute returns the run summary; the unified receipt is the durable artifact.
    return getReceipt((json.runId as string) ?? q.runId);
  }

  async function runAgent(goal: string, opts: AgentRunOptions = {}): Promise<{ runId: string }> {
    const { status, json } = await req("/v1/agent/run", { goal, budgetUSDC: opts.budgetUSDC, projectId: opts.projectId });
    if (status >= 400 || json?.error) {
      throw new AxisPayError(json?.error?.code ?? "AGENT_RUN_FAILED", json?.error?.message ?? `agent run failed (${status})`);
    }
    return { runId: json.runId as string };
  }

  function onEvents(runId: string, cb: (event: Record<string, unknown>) => void): () => void {
    const ES = (globalThis as any).EventSource;
    if (!ES) throw new AxisPayError("NO_EVENTSOURCE", "global EventSource unavailable in this runtime");
    const es = new ES(`${base}/v1/runs/${runId}/events?key=${encodeURIComponent(options.apiKey ?? "")}`);
    const handler = (e: any) => { try { cb(JSON.parse(e.data)); } catch { /* ignore */ } };
    es.onmessage = handler;
    for (const t of EVENT_TYPES) es.addEventListener(t, handler);
    return () => es.close();
  }

  async function listProjects(): Promise<ProjectSummary[]> {
    return (await getJson("/v1/projects", "PROJECTS_FAILED")).projects ?? [];
  }
  /** `budgetUSDC` makes this project's spend automatic for the autonomous
   *  agent: every run tagged to it gets whatever headroom is left, with no
   *  per-run number to pass. Omit it for a project with no ceiling of its
   *  own (the server's spend-policy limits still apply). */
  async function createProject(name: string, budgetUSDC?: number): Promise<ProjectSummary> {
    const { status, json } = await req("/v1/projects", { name, budgetUSDC });
    if (status >= 400 || json?.error) throw new AxisPayError(json?.error?.code ?? "PROJECT_FAILED", json?.error?.message ?? "could not create project");
    return json as ProjectSummary;
  }

  return { whoami, listWorkflows, quote, pay, runAgent, getReceipt, onEvents, listProjects, createProject };
}

const EVENT_TYPES = [
  "run.started", "probe.sent", "challenge.received", "quote.ready", "policy.evaluated",
  "group.composed", "group.simulated", "group.signed", "group.settled",
  "step.started", "step.delivered", "step.failed", "step.skipped",
  "compensation.issued", "node.state", "run.completed", "run.error",
];
