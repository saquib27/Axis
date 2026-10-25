/**
 * Typed API client. Phase F1.4.
 *
 * The ONLY place the console talks to the router. Every shape is imported from
 * @axis/shared or mirrors the router's response — the UI never re-declares a
 * type, so backend and frontend cannot drift.
 */
const BASE = process.env.NEXT_PUBLIC_ROUTER_URL ?? "http://localhost:8080";

export interface QuoteResponse {
  runId: string;
  quoteId: string;
  workflow: string;
  network: string;
  dag: { batches: string[][]; edges: { from: string; to: string }[] };
  legs: { stepId: string; provider: string; payTo: string; priceUSDC: string; asset: string }[];
  subtotalUSDC: string;
  routingFeeUSDC: string;
  totalUSDC: string;
  expiresAt: string;
  signature: string;
}

export interface ExecuteResponse {
  runId: string;
  groupId: string;
  confirmedRound: number;
  txids: { stepId: string; provider: string; payTo: string; txid: string; amountUSDC: string; explorerUrl: string }[];
}

export interface ApiError {
  error: { code: string; message: string; costedNothing?: boolean };
}

export interface ReceiptSummary {
  receiptId: string;
  workflow: string;
  status: string;
  agentAddress: string;
  groupId: string;
  projectId: string | null;
  totalUSDC: string;
  refundedUSDC: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  apiKey: string;
  user: { id: string; email: string };
}

export interface WorkflowInfo {
  id: string;
  steps: { id: string; provider: string; path: string }[];
  inputs: string[];
}

export interface RefundSummary {
  receiptId: string; workflow: string; status: string;
  refundedUSDC: string; totalUSDC: string; projectId: string | null; createdAt: string;
}

export interface Usage {
  runs: number; settled: number; partial: number; failed: number;
  grossUSDC: string; refundedUSDC: string; netUSDC: string;
}

export interface ProjectSummary {
  id: string; name: string; createdAt: string;
  runs: number; grossUSDC: string; refundedUSDC: string; netUSDC: string;
  /** Total budget for this project, or null if it has none of its own —
   *  only the server's spend-policy limits apply then. */
  budgetUSDC: string | null;
  /** Headroom left under that budget, or null when there is no budget. */
  remainingUSDC: string | null;
}

export interface ProjectRun {
  receiptId: string; workflow: string; status: string;
  /** Best-effort one-line preview of what was asked — the diff/commit message/goal. */
  prompt: string;
  totalUSDC: string; refundedUSDC: string; createdAt: string;
}

export interface ProjectDetail {
  id: string; name: string; createdAt: string;
  totals: { runs: number; grossUSDC: string; refundedUSDC: string; netUSDC: string; budgetUSDC: string | null; remainingUSDC: string | null };
  runs: ProjectRun[];
}

/** The logged-in account's API key, sent so the router scopes data to this user. */
function keyHeaders(): Record<string, string> {
  const k = typeof window === "undefined" ? null : localStorage.getItem("axis_apikey");
  return k ? { "x-api-key": k } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers: { ...keyHeaders(), ...init?.headers } });
  } catch {
    throw { error: { code: "BACKEND_UNAVAILABLE", message: "Cannot connect to the server. Please try again shortly." } } satisfies ApiError;
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw (json && typeof json === "object" && "error" in json ? json : { error: { code: "SERVER_ERROR", message: `Server request failed (${res.status}). Please try again.` } }) as ApiError;
  if (json == null) throw { error: { code: "INVALID_RESPONSE", message: "The server returned an invalid response. Please try again." } } satisfies ApiError;
  return json as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function get<T>(path: string): Promise<T> { return request<T>(path); }

export const api = {
  demo: () => post<{ runId: string; demo: true }>("/v1/demo/run", {}),
  /** The router defaults to its own funded wallet, so no address is hardcoded here. */
  quote: (inputs: Record<string, unknown>, workflow = "pr-review") =>
    post<QuoteResponse>("/v1/workflow/quote", { workflow, inputs }),

  execute: (quoteId: string, runId?: string, projectId?: string) =>
    post<ExecuteResponse>("/v1/workflow/execute", { quoteId, runId, projectId }),

  /** Demo: force a named step to fail after payment (compensation path). */
  executeChaos: (quoteId: string, runId: string, chaos: string, projectId?: string) =>
    post<ExecuteResponse>("/v1/workflow/execute", { quoteId, runId, chaos, projectId }),

  /** Pre-settle a real payment so the next attack fires instantly (~2s not ~7s). */
  primeAttack: () => post<{ proof: string }>("/v1/redteam/prime", {}),

  /** Fire a red-team attack against our own endpoints; returns the block result.
   *  Pass a primed proof to skip the on-chain settle on the click. */
  attack: (id: string, proof?: string) => post<{ fired: number; blocked: number; granted: number; mitigation: string; detail: string; sample?: string[] }>(`/v1/redteam/${id}`, { proof }),

  /** The workflows (services) available to run. */
  workflows: () => fetch(`${BASE}/v1/workflows`).then((r) => r.json() as Promise<{ workflows: WorkflowInfo[] }>),

  /** This account's runs/receipts, newest first. */
  receipts: () => get<{ receipts: ReceiptSummary[] }>("/v1/receipts"),

  /** Launch the autonomous agent: it picks a workflow from the goal and pays
   *  atomically. Budget is automatic when a budgeted project is tagged
   *  (whatever headroom is left); omit budgetUSDC to use that, or pass it to
   *  set an explicit hard cap instead. Returns a runId to stream live. */
  runAgent: (goal: string, projectId?: string, budgetUSDC?: number) => post<{ runId: string }>("/v1/agent/run", { goal, budgetUSDC, projectId }),

  /** This account's runs that got money back on chain. */
  refunds: () => get<{ refunds: RefundSummary[] }>("/v1/refunds"),

  /** Spend totals for this account. */
  usage: () => get<Usage>("/v1/usage"),

  /** Projects — group runs and see per-project spend (scoped to this account).
   *  budgetUSDC makes the autonomous agent's spend automatic within it. */
  projects: () => get<{ projects: ProjectSummary[] }>("/v1/projects"),
  createProject: (name: string, budgetUSDC?: number) => post<ProjectSummary>("/v1/projects", { name, budgetUSDC }),
  project: (id: string) => get<ProjectDetail>(`/v1/projects/${id}`),

  /** JWT auth — plain email + password, no third-party provider. */
  signup: (email: string, password: string) => post<AuthResponse>("/v1/auth/signup", { email, password }),
  login: (email: string, password: string) => post<AuthResponse>("/v1/auth/login", { email, password }),

  /** SSE endpoint URL for a run — consumed by useRunStream. */
  eventsUrl: (runId: string) => `${BASE}/v1/runs/${runId}/events?key=${encodeURIComponent(session.apiKey() ?? "")}`,
};

// ── Client-side session (localStorage). No secrets — just the JWT + email. ──
export const session = {
  save: (a: AuthResponse) => {
    if (typeof window === "undefined") return;
    localStorage.setItem("axis_token", a.token);
    localStorage.setItem("axis_email", a.user.email);
    if (a.apiKey) localStorage.setItem("axis_apikey", a.apiKey);
  },
  email: () => (typeof window === "undefined" ? null : localStorage.getItem("axis_email")),
  token: () => (typeof window === "undefined" ? null : localStorage.getItem("axis_token")),
  apiKey: () => (typeof window === "undefined" ? null : localStorage.getItem("axis_apikey")),
  clear: () => {
    if (typeof window === "undefined") return;
    localStorage.removeItem("axis_token");
    localStorage.removeItem("axis_email");
    localStorage.removeItem("axis_apikey");
  },
};
