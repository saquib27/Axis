/**
 * AXIS MCP server — lets any MCP-capable AI agent (Claude Desktop, Cursor,
 * Claude Code) atomically pay N x402 APIs on Algorand and get a receipt.
 *
 * Three tools, each a thin wrapper over @axis/pay:
 *   - list_workflows   what the agent can run
 *   - quote_workflow   the price, with ZERO payment
 *   - pay_and_run      settle ONE atomic group, return results + receipt
 *
 * The router holds the wallet and signs; this server never touches a key. It
 * speaks JSON-RPC over stdio, so `stdout` is reserved for the protocol — all
 * diagnostics go to stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { createAxisClient, AxisPayError, type AxisClient } from "axis-pay";

const routerUrl = process.env.ROUTER_URL ?? "http://localhost:8080";
const defaultAgent = process.env.AGENT_ADDRESS ?? "NG5SZZ3U6XOB4L5N4CPZ7SLIZRDIEK2CM4XMB5WDPLAWSCIRCIJTTKYOPQ";

/**
 * The account key can arrive two ways:
 *
 *  1. AXIS_API_KEY in the server's env — set once by whoever installed it.
 *  2. The `connect_account` tool, at runtime, in conversation.
 *
 * (2) exists because editing a JSON config by hand is not something you can
 * ask of every user. Connecting in chat means the flow is: sign up, copy key,
 * tell Claude to connect. The key is written to ~/.axis/credentials (0600) so
 * it survives a restart and nobody has to paste it twice.
 *
 * The tradeoff is real and worth stating: a key pasted into chat is in the
 * conversation history. The env var avoids that, so it stays the better
 * option for a shared or recorded machine.
 */
const CRED_FILE = join(homedir(), ".axis", "credentials");

function readStoredKey(): string | undefined {
  try {
    const k = JSON.parse(readFileSync(CRED_FILE, "utf8"))?.apiKey;
    return typeof k === "string" && k ? k : undefined;
  } catch { return undefined; }
}
function writeStoredKey(key: string): void {
  mkdirSync(dirname(CRED_FILE), { recursive: true, mode: 0o700 });
  writeFileSync(CRED_FILE, JSON.stringify({ apiKey: key }, null, 2), { mode: 0o600 });
  chmodSync(CRED_FILE, 0o600);   // enforce it even if the file already existed
}

let apiKey: string | undefined = process.env.AXIS_API_KEY ?? readStoredKey();
let axis: AxisClient = createAxisClient({ routerUrl, apiKey });
/** Rebuild the client so every later call carries the new key. */
function useKey(key: string | undefined): void {
  apiKey = key;
  axis = createAxisClient({ routerUrl, apiKey: key });
}

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

/** Account data is per-key. Say so once, in words the user can act on, rather
 *  than letting every tool fail with a bare 401. */
const NO_KEY_HELP =
  "No AXIS account is connected yet.\n\n" +
  "Ask me to connect it — say \"connect my AXIS account, my key is axis_…\" — and I'll\n" +
  "verify it and remember it for next time.\n\n" +
  "Get your key from the AXIS console: Projects page → the key bar → copy.\n" +
  "(Prefer not to paste it in chat? Set AXIS_API_KEY in this server's env instead.)";
const needsKey = () => !apiKey;

/**
 * Build the workflow inputs. If `filePath` is given, its contents become the
 * `diff` (so you can review a file by name instead of pasting it), and the
 * commit message defaults to "Review <filename>".
 */
function buildInputs(inputs: Record<string, unknown> | undefined, filePath?: string, commitMessage?: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(inputs ?? {}) };
  if (filePath) {
    const content = readFileSync(filePath, "utf8").slice(0, 20_000); // match the provider input cap
    out.diff = content;
    out.commitMessage = commitMessage ?? out.commitMessage ?? `Review ${basename(filePath)}`;
  } else if (commitMessage) {
    out.commitMessage = commitMessage;
  }
  return out;
}

const server = new McpServer({ name: "axis-pay", version: "0.1.0" });

server.registerTool(
  "connect_account",
  {
    title: "Connect an AXIS account",
    description:
      "Connect the user's AXIS account by API key so every later tool call — projects, quotes, payments — belongs to them and shows up live in their console and Chrome extension. " +
      "Use this the moment the user offers a key, or when any tool reports that no account is connected. " +
      "The key is verified against the router before it is saved, and it is remembered across restarts. " +
      "Never invent a key: if the user has not given one, tell them to copy it from the AXIS console's Projects page.",
    inputSchema: {
      apiKey: z.string().min(8).describe("the user's AXIS account API key, e.g. axis_a59f26f4… — taken verbatim from what they provided, never guessed"),
    },
  },
  async ({ apiKey: given }) => {
    const key = given.trim();
    const previous = apiKey;
    useKey(key);
    try {
      const me = await axis.whoami();           // reject a bad key before storing it
      writeStoredKey(key);
      return text(
        `Connected as ${me.email}.\n\n` +
        `Projects, payments and receipts from now on belong to this account, and runs will appear live ` +
        `in its console and Chrome extension. Saved to ~/.axis/credentials so this only needs doing once.`,
      );
    } catch (e) {
      useKey(previous);                          // leave the old account intact on failure
      return text(
        `That key was not accepted: ${(e as AxisPayError).message}\n\n` +
        `Check it was copied whole from the AXIS console (Projects page → key bar → copy), ` +
        `and that the router at ${routerUrl} is running.`,
        true,
      );
    }
  },
);

server.registerTool(
  "disconnect_account",
  {
    title: "Disconnect the AXIS account",
    description: "Forget the stored AXIS API key on this machine. Use when the user wants to switch accounts or stop this connection.",
    inputSchema: {},
  },
  async () => {
    try { rmSync(CRED_FILE, { force: true }); } catch { /* nothing stored */ }
    useKey(process.env.AXIS_API_KEY);
    return text(apiKey
      ? "Stored key removed. Still connected via the AXIS_API_KEY set in this server's environment."
      : "Disconnected. No AXIS account is connected now.");
  },
);

server.registerTool(
  "whoami",
  {
    title: "Which AXIS account am I acting as?",
    description: "Show which AXIS account this connection spends from — its email and id. Call this before creating projects or paying for anything, and whenever the user asks whose account is in use. The account comes from the AXIS_API_KEY this server was started with; it is never entered in chat.",
    inputSchema: {},
  },
  async () => {
    if (needsKey()) return text(NO_KEY_HELP, true);
    try {
      const me = await axis.whoami();
      return text(`Acting as ${me.email} (${me.id}). Projects created and money spent through these tools belong to this account.`);
    } catch (e) {
      return text(`Could not identify the account: ${(e as AxisPayError).message}`, true);
    }
  },
);

server.registerTool(
  "list_workflows",
  {
    title: "List AXIS workflows",
    description: "List the multi-provider x402 workflows this AXIS router can run, with each workflow's provider steps and the inputs it needs.",
    inputSchema: {},
  },
  async () => {
    const workflows = await axis.listWorkflows();
    const lines = workflows.map((w) =>
      `• ${w.id} — ${w.steps.map((s) => s.provider).join(", ")}  (inputs: ${w.inputs.join(", ") || "none"})`);
    return text(`Available workflows:\n${lines.join("\n")}`);
  },
);

server.registerTool(
  "quote_workflow",
  {
    title: "Quote a workflow (no payment)",
    description: "Price a workflow by reading each provider's live x402 challenge. No money moves. Returns the total, per-provider prices, and whether the spend policy allows it. Call this before pay_and_run. You can pass `inputs` directly, OR a `filePath` to a local file whose contents become the diff to review.",
    inputSchema: {
      workflow: z.string().describe("workflow id, e.g. 'pr-review'"),
      inputs: z.record(z.any()).optional().describe("the workflow's inputs, e.g. { diff, commitMessage }"),
      filePath: z.string().optional().describe("absolute path to a local file to review; its contents become the diff — use this instead of pasting a diff"),
      commitMessage: z.string().optional().describe("commit message for the review; defaults to 'Review <filename>' when a filePath is given"),
      agentAddress: z.string().optional().describe("Algorand address paying; defaults to the server's configured agent"),
    },
  },
  async ({ workflow, inputs, filePath, commitMessage, agentAddress }) => {
    try {
      const q = await axis.quote(workflow, buildInputs(inputs as Record<string, unknown>, filePath, commitMessage), agentAddress ?? defaultAgent);
      const legs = q.legs.map((l) => `  - ${l.provider}: $${l.priceUSDC}`).join("\n");
      return text(`Quote for "${workflow}":\n  total: $${q.totalUSDC}\n  spend policy: ${q.policy.verdict}\n${legs}`);
    } catch (e) {
      return text(`Could not quote: ${(e as AxisPayError).code ?? "ERROR"} — ${(e as Error).message}`, true);
    }
  },
);

server.registerTool(
  "pay_and_run",
  {
    title: "Pay and run a workflow atomically",
    description: "Pay all of a workflow's providers in ONE atomic Algorand group (one signature, all-or-nothing) and return each provider's result plus a unified receipt. You can pass `inputs` directly, OR a `filePath` to a local file to review (its contents become the diff). If budgetUSDC is set and the quote exceeds it, nothing is paid. If a provider takes payment but fails, its leg is refunded on-chain and the run is PARTIAL.",
    inputSchema: {
      workflow: z.string().describe("workflow id, e.g. 'pr-review'"),
      inputs: z.record(z.any()).optional().describe("the workflow's inputs, e.g. { diff, commitMessage }"),
      filePath: z.string().optional().describe("absolute path to a local file to review; its contents become the diff — use this instead of pasting a diff"),
      commitMessage: z.string().optional().describe("commit message for the review; defaults to 'Review <filename>' when a filePath is given"),
      budgetUSDC: z.number().positive().optional().describe("hard spending ceiling in USDC; the payment is refused before settling if the quote exceeds it"),
      projectId: z.string().optional().describe("tag this run to a project (see list_projects / create_project)"),
      agentAddress: z.string().optional().describe("Algorand address paying; defaults to the server's configured agent"),
    },
  },
  async ({ workflow, inputs, filePath, commitMessage, budgetUSDC, projectId, agentAddress }) => {
    try {
      const r = await axis.pay(workflow, buildInputs(inputs as Record<string, unknown>, filePath, commitMessage), agentAddress ?? defaultAgent, { budgetUSDC, projectId });
      const legs = r.legs.map((l) => `  - ${l.provider} [${l.status}] ${l.explorerUrl}`).join("\n");
      const results = r.legs
        .filter((l) => l.result != null)
        .map((l) => `### ${l.provider}\n${typeof l.result === "string" ? l.result : JSON.stringify(l.result, null, 2)}`)
        .join("\n\n");
      return text(
        `${r.status} — $${r.totalUSDC} paid across ${r.legs.length} providers in one atomic group (round ${r.confirmedRound}).\n` +
        `group ${r.groupId}\n${legs}\n` +
        (Number(r.refundedUSDC) > 0 ? `refunded on-chain: $${r.refundedUSDC}\n` : "") +
        `\nResults:\n\n${results}`,
      );
    } catch (e) {
      const err = e as AxisPayError;
      return text(`No payment was made (${err.code ?? "ERROR"}): ${err.message}`, true);
    }
  },
);

server.registerTool(
  "list_projects",
  {
    title: "List projects",
    description: "List projects that group runs, each with its total spend, refunds, and — if it has one — its budget and remaining headroom. Use a project's id as `projectId` in pay_and_run / run_agent to tag a run to it.",
    inputSchema: {},
  },
  async () => {
    if (needsKey()) return text(NO_KEY_HELP, true);
    const projects = await axis.listProjects();
    if (projects.length === 0) return text("No projects yet. Use create_project to make one.");
    return text("Projects:\n" + projects.map((p) =>
      `• ${p.name} (${p.id}) — ${p.runs} runs, net $${p.netUSDC}` +
      `${Number(p.refundedUSDC) > 0 ? `, refunded $${p.refundedUSDC}` : ""}` +
      `${p.budgetUSDC != null ? `, budget $${p.budgetUSDC} ($${p.remainingUSDC} left)` : ""}`,
    ).join("\n"));
  },
);

server.registerTool(
  "create_project",
  {
    title: "Create a project",
    description: "Create a named project to group runs under. Give it a budgetUSDC and every run_agent call tagged to it is capped automatically at whatever headroom is left — no per-run budget to pass. Returns its id, which you pass as `projectId` to pay_and_run / run_agent.",
    inputSchema: {
      name: z.string().describe("the project name"),
      budgetUSDC: z.number().positive().optional().describe("total spending ceiling for this project; omit for no ceiling of its own (the server's spend-policy limits still apply)"),
    },
  },
  async ({ name, budgetUSDC }) => {
    if (needsKey()) return text(NO_KEY_HELP, true);
    try {
      const p = await axis.createProject(name, budgetUSDC);
      return text(
        `Created project "${p.name}" — id ${p.id}` +
        `${p.budgetUSDC != null ? `, budget $${p.budgetUSDC}` : ""}. ` +
        `Pass projectId: "${p.id}" to pay_and_run or run_agent to tag runs to it.`,
      );
    } catch (e) {
      return text(`Could not create project: ${(e as AxisPayError).message}`, true);
    }
  },
);

server.registerTool(
  "run_agent",
  {
    title: "Run the autonomous agent on a plain-English task",
    description: "Describe a task in plain English; an LLM decides whether an available service can genuinely do it. If one fits, it quotes, pays atomically, and returns the results plus a receipt. If nothing fits, it refuses and spends nothing — it will NOT run an unrelated workflow just to do something. Pass `projectId` for an automatic budget (whatever headroom that project has left); otherwise the server's own spend-policy limits are the only ceiling. Runs in the background; this call returns a runId immediately — poll get_run_result or just wait, then check list_projects / the console for the outcome.",
    inputSchema: {
      goal: z.string().describe("the task, in plain English, e.g. 'Review this diff and flag anything risky before merging.'"),
      budgetUSDC: z.number().positive().optional().describe("hard spending ceiling in USDC; overrides a project's automatic budget if both are given"),
      projectId: z.string().optional().describe("tag this run to a project (see list_projects / create_project) — also how it gets an automatic budget"),
    },
  },
  async ({ goal, budgetUSDC, projectId }) => {
    if (needsKey()) return text(NO_KEY_HELP, true);
    try {
      const { runId } = await axis.runAgent(goal, { budgetUSDC, projectId });
      return text(`Agent started — runId ${runId}. It's running now: watch the console's Workflow page or the Chrome extension for it live, or call get_run_result once it's done.`);
    } catch (e) {
      return text(`Could not start the agent: ${(e as AxisPayError).message}`, true);
    }
  },
);

server.registerTool(
  "get_run_result",
  {
    title: "Get a run's result",
    description: "Fetch the unified receipt for a run — its status (SETTLED / PARTIAL / FAILED / REVERSED), what was paid, and every provider's result. Use the runId returned by run_agent or pay_and_run.",
    inputSchema: { runId: z.string().describe("the run id, e.g. 'run_ab12cd34ef56'") },
  },
  async ({ runId }) => {
    try {
      const r = await axis.getReceipt(runId);
      const legs = r.legs.map((l) => `  - ${l.provider} [${l.status}] ${l.explorerUrl}`).join("\n");
      return text(`${r.status} — $${r.totalUSDC} across ${r.legs.length} providers.\n${legs}`);
    } catch (e) {
      return text(`No result yet for ${runId} — it may still be running.`, true);
    }
  },
);

await server.connect(new StdioServerTransport());

// Name the account in the log the operator can actually see. Resolving it
// needs the router, so this is best-effort and never blocks startup.
const bootKey = apiKey;
if (bootKey) {
  axis.whoami()
    .then((me) => process.stderr.write(`axis-pay MCP ready → router ${routerUrl} · acting as ${me.email}\n`))
    .catch(() => process.stderr.write(`axis-pay MCP ready → router ${routerUrl} · account ${bootKey.slice(0, 12)}… (could not resolve owner)\n`));
} else {
  process.stderr.write(`axis-pay MCP ready → router ${routerUrl} · account NOT SET (set AXIS_API_KEY)\n`);
}
