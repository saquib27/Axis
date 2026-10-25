# AXIS Console

The live dashboard. Every button runs a real workflow; everything on screen is
driven by the router's actual event stream — nothing is scripted or replayed
from a recording.

## Pages

| Route | What it does |
|---|---|
| `/` | Marketing landing page — the pitch, the looping architecture animation, links into the console. Not authenticated. |
| `/login`, `/signup` | Plain email + password auth (JWT). On success, the account's API key is saved to `localStorage` and every subsequent request is scoped to it. |
| `/projects` | **Projects — the home page.** Stat tiles across the top, then every project as a card. Create one with the inline field in the header. Clicking a card opens the **drawer** (below). |
| `/agent` | **Autonomous agent.** Type a task in plain English, pick a project, run. An LLM (NVIDIA NIM) picks the workflow, quotes it, and either pays or refuses and spends nothing. No budget field anywhere — spend is bounded by the router's own spend-policy limits. |
| `/workflow` | **Activity across every project.** The project cards plus a live feed of recent tasks from anywhere — this console, the agent, or an MCP client like Claude. Clicking a project (or a task's project) opens the same drawer. `?project=<id>` deep-links straight into it. |
| `/failure` | **Test failure.** Describe a change, pick which of the four `pr-review` providers should fail *after* being paid, and run it — proves the compensation path: payment atomicity is not delivery, so a provider that takes money and dies gets reversed on-chain and the run lands as `PARTIAL`. |
| `/attack` | **Start attack.** Fires real attacks (replay, cross-resource reuse, race, wrong-network, tamper) against the router's own endpoints and shows what's blocked vs. granted — a live security proof, not a slide. |
| `/receipts` | Every run in the DB, newest first — the receipts index. Links to each run's unified receipt. |
| `/receipts/:id` | One receipt, standalone — group id, every txid, per-leg status, refunds. Designed to open cold, hours later, with every link still resolving. |
| `/refunds` | Every run that got money back on-chain — the compensation ledger. |
| `/protocol` | **How it works.** The 8-step x402 → quote → policy → compose → simulate → sign → settle flow, in plain language, plus why Algorand (atomic groups, ~3s finality, fee pooling). |

### The project drawer

`components/ProjectDrawer.tsx` is the console's main working surface, shared by
`/projects` and `/workflow`. It slides over the page and holds one project's
whole recording: totals, the run happening *right now* (streamed off the
router's real SSE endpoint), and every task ever run under it with its prompt,
cost, refund and receipt.

It polls while open, so a task fired from anywhere else — the autonomous agent,
an MCP client like Claude — appears as it happens with no reload. It only
attaches the live stream to a run whose status is still `PENDING`; a finished
run would otherwise replay its buffered events and render a "running now" panel
for something that ended hours ago.

### Budgets

There is no budget field in the UI. Spend is bounded server-side by the
router's spend policy (per-workflow, per-provider, hourly, velocity) — the same
backstop every run gets whether it came from this console, the SDK, or an MCP
agent. The `budgetUSDC` plumbing still exists in the API for callers that want
their own hard cap.

## The rule

The console renders what it receives. It holds **no** business logic, **no**
keys, and never computes money. If something needs deriving, it belongs in
`lib/state-machine.ts` — a pure function, unit tested, with no React in it.

## You are not blocked on the backend

`@axis/shared` exports `mockRun()`, a complete run emitted as real `RunEvent`
values with realistic per-event timing. Build and animate against it today.

```ts
import { mockRun } from "@axis/shared";

for await (const event of mockRun({ scenario: "partial" })) {
  setState((s) => applyEvent(s, event));   // lib/state-machine.ts
}
```

Four scenarios. `partial` is the default **on purpose** — it exercises a
provider being paid, failing, and being refunded on chain, which is the hardest
path to build and the best thing to demo.

| scenario | what it exercises |
|---|---|
| `happy` | settles; 4 txids to 4 distinct payees; 1 signature |
| `partial` | a provider is PAID, FAILS, and is REFUNDED — money moves backwards |
| `policyBlocked` | rejected pre-signature; nothing composed; **cost zero** |
| `simulationFailed` | composed but never submitted; **cost zero** |

Going live later is one line: swap `mockRun()` for `useRunStream(runId)`.
