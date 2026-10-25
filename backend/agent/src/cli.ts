/**
 * CLI for the autonomous budgeted agent.
 *
 *   node src/cli.ts "review this PR: bump timeout 10->60" 1.00
 *   node src/cli.ts "<goal>" 0.05        # tiny budget → the agent declines
 *
 * Reads NVIDIA_API_KEY / ROUTER_URL / AGENT_ADDRESS from ../../.env(.accounts).
 */
import { runAutonomousAgent } from "./index.ts";

// node's built-in env loader — no dotenv dependency.
for (const f of ["../../.env", "../../.env.accounts"]) {
  try { process.loadEnvFile(new URL(f, import.meta.url)); } catch { /* optional */ }
}

const goal = process.argv[2] ?? process.env.GOAL ?? "Review this diff: - const timeout = 10\\n+ const timeout = 60 (commit: bump timeout to 60s)";
const budgetUSDC = Number(process.argv[3] ?? process.env.BUDGET ?? "1.00");

const outcome = await runAutonomousAgent({
  goal,
  budgetUSDC,
  routerUrl: process.env.ROUTER_URL ?? "http://localhost:8080",
  agentAddress: process.env.AGENT_ADDRESS,
  nim: process.env.NVIDIA_API_KEY
    ? { apiKey: process.env.NVIDIA_API_KEY, baseUrl: process.env.NVIDIA_BASE_URL, model: process.env.NVIDIA_MODEL }
    : undefined,
  log: (line) => console.log(line),
});

console.log(`\n── outcome ──`);
console.log(`paid: ${outcome.paid}${outcome.paid ? ` · ${outcome.receipt?.status} · $${outcome.receipt?.totalUSDC}` : ` · ${outcome.reason}`}`);
process.exit(0);
