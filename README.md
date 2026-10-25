# AXIS

**Atomic X402 Integrated Settlement** — an agent-native aggregator that turns N paid API calls into one all-or-nothing payment on Algorand.

> HackNite Code Royale 2026 · x402 & Algorand Track
> Sub-track: **Entry Management Framework — Atomic Agent Aggregators & Multi-Step Workflows**

---

## The problem

x402 solved the single call. An agent hits an endpoint, gets `402 Payment Required`, signs, retries, gets data. Clean.

Real agent work isn't a single call. A research agent, a PR reviewer, a due-diligence pipeline — each fans out across **five, ten, twenty** paid endpoints owned by different providers. Today that means:

- **N separate signatures.** The human-in-the-loop x402 was supposed to eliminate comes right back.
- **N unrelated payments.** Step 4 fails and you've already paid for steps 1–3. Money gone, workflow dead, no result.
- **N orphaned receipts.** No way to answer "what did this one report actually cost me?"
- **No spend ceiling.** An agent in a retry loop can drain a treasury before anyone notices.

Per-call payments don't compose. That's the gap.

## What AXIS does

AXIS sits between the agent and the providers. The agent describes a *workflow*; AXIS handles the money.

```
agent ──▶ AXIS ──┬──▶ provider A ($0.02)
                 ├──▶ provider B ($0.05)
                 ├──▶ provider C ($0.03)
                 └──▶ provider D ($0.03)

one signature · one atomic group · one receipt · $0.13
```

Either every provider gets paid and every result comes back, or nothing settles and the agent is out zero.

## What's built (live on Algorand testnet)

- **9 paid services** across 5 workers, each a distinct USDC payee: `diff-explainer`,
  `guardrail-checker`, `commit-roaster`, `bug-summarizer` + a toolbox of
  `code-generator`, `debugger`, `test-writer`, `translator`, `summarizer`.
- **`deep-review`** — the flagship workflow: **all 9 providers, 9 distinct
  payees, one signature, one atomic group** ($0.31 total). That is 10 of
  Algorand's 16 group slots once the facilitator's fee payer is counted. Any
  provider that fails to deliver is **refunded on chain**; the run is marked
  `PARTIAL`.
- **Spend Policy Guard** (6 rules) — a FAIL means nothing is ever signed.
- **Facilitator feePayer** (GoPlausible) — the agent needs only USDC, no ALGO.
- **Auto-retry** on settlement (2 tries, then stop) + a **manual retry** button.
- **Agent-facing layer:** the `axis-pay` **SDK**, an **MCP server** (Claude /
  Cursor can atomically pay N x402 APIs natively), and an **autonomous budgeted
  agent** that picks a service from a goal and refuses anything it can't do.
- **Console** with projects / refunds / usage dashboards + JWT auth, and a
  **Chrome Live-Monitor extension** — an animated flowchart showing all services
  (used ones lit + coins, unused ✕), a live backend terminal, and the receipt.
- **Red-team:** the 3 x402 attacks that hit any server, blocked **live**; the
  other 2 are structurally impossible on Algorand.

See [`docs/BRIEF.md`](docs/BRIEF.md) for the full write-up and
[`docs/FEATURES.md`](docs/FEATURES.md) for how to verify every feature.

## Why this is only clean on Algorand

This is the core of the submission.

On most chains "atomic across N providers" means faking it — escrow contracts, hold-and-capture, refund queues, eventual consistency. You end up building a payment processor.

Algorand gives it natively. **Atomic transaction groups**: up to 16 transactions submitted as one unit, all committed or all rejected, no smart contract required, ~3s finality. The AVM x402 mechanism already builds on groups and pooled fees.

So AXIS composes N payment legs to N *different* provider addresses into a single group, gets one signature from the agent, and submits. Atomicity is a property of the chain, not of our code.

Three things fall out of this for free:

| | |
|---|---|
| **One signature** | Agent authorizes the whole workflow, not each hop. |
| **Pre-flight simulation** | `simulateTransactions` validates the entire group before a single microalgo moves. |
| **Fee abstraction** | Facilitator co-signs as `feePayer` — the agent needs USDC, not ALGO. |

## Architecture

AXIS runs a strict **two-phase** protocol. Nothing is paid during discovery.

### Phase 1 — Quote

```
1. Agent POSTs a workflow spec        → AXIS
2. AXIS fans out unpaid probes        → all providers
3. Providers return 402 challenges    → AXIS
4. AXIS resolves the DAG, sums cost   → returns a signed quote
```

Every provider states its price via its own `402`. AXIS resolves the dependency graph (which steps need which outputs), computes total cost, and returns a quote with a TTL. **Zero payments have occurred.**

### Phase 2 — Policy gate

Before anything is signed, the quote passes the **Spend Policy Guard**:

- per-workflow ceiling
- per-provider cap
- rolling velocity limit (calls/hour, spend/hour)
- provider trust threshold
- global kill switch

Fail any check → the workflow is rejected before a group is even built. This is the Agent Infrastructure sub-track, folded in as a mandatory pre-flight step rather than a bolt-on advisory API.

### Phase 3 — Compose & sign

```
5. AXIS builds ONE atomic group       (N payment legs, N providers)
6. simulateTransactions               (dry run — catch failures free)
7. Agent signs the group              ← the only signature
8. Facilitator verifies + settles     → group confirmed
```

### Phase 4 — Execute & receipt

```
9.  AXIS retries every call with its payment proof
10. Results collected, DAG resolved in order
11. Unified receipt emitted: group ID → N txids → N results
```

### Failure modes

Payment atomicity is not execution atomicity. We handle both:

| Failure | Handling |
|---|---|
| Quote expired | TTL enforced; re-quote. Nothing signed, nothing lost. |
| Policy violation | Rejected pre-signature. Zero cost. |
| Simulation fails | Group never submitted. Zero cost. |
| Group rejected on-chain | Native all-or-nothing. Zero cost. |
| **Provider 500s post-settlement** | Compensation leg — provider's escrowed portion is reversed and the run is marked `PARTIAL`. Receipt records the refund txid. |
| Provider times out | Retry with backoff inside `maxTimeoutSeconds`, then compensation. |

That last row is the one most submissions will miss. Settlement succeeding does not mean the service delivered.

## Repo structure

```text
./
├── backend/          # API router, shared code, guard, SDK, MCP and providers
├── frontend/console/ # Next.js dashboard
├── extension/        # Chrome live monitor
├── scripts/          # Local development tools
├── docs/             # Architecture, setup and feature guides
│   └── notes/        # Original rough notes and project story
├── backups/          # Original ZIP archive (ignored by Git)
├── package.json      # Workspace commands
├── pnpm-workspace.yaml
└── tsconfig.json
```

Run workspace commands from this folder. See [local setup](docs/RUN_LOCAL.md)
and [contribution guide](CONTRIBUTING.md). Local database data and downloaded
runtimes remain in `.local/` and `.local-tools/` (ignored by Git).

## Provider endpoints

**Nine paid x402 endpoints across five Cloudflare Workers.** The four core
providers each run on a **separate Algorand payout address**, so the `pr-review`
atomic group genuinely spans multiple payees rather than paying ourselves once.
Each states its price only in its own `402` — the router never hardcodes it. All
run real LLM work behind the payment (NVIDIA NIM `meta/llama-3.1-8b-instruct`);
no mocks in the money path.

**Core providers (four distinct payees, composed by `pr-review`):**

| Endpoint | Price | Returns |
|---|---|---|
| `POST /diff/explain` | $0.03 | Plain-language explanation of a git diff |
| `POST /guardrail/check` | $0.02 | Prompt-injection / jailbreak / policy risk score |
| `POST /commit/roast` | $0.03 | Commit message critique + rewritten alternatives |
| `POST /bug/summarize` | $0.05 | Noisy bug report → reproducible steps + severity |

**Toolbox (five services on one Worker, shared payout address):**

| Endpoint | Price | Returns |
|---|---|---|
| `POST /code/generate` | $0.05 | Write code for a described task |
| `POST /debug/fix` | $0.04 | Diagnose an error and propose a fix |
| `POST /test/write` | $0.04 | Unit tests for a piece of code |
| `POST /translate` | $0.02 | Translate text to a target language |
| `POST /summarize` | $0.02 | Summarise a long piece of text |

All settle in **USDC ASA on Algorand Testnet**. Every endpoint exposes
`GET /health` returning its name, price, and payout address.

## Demo workflow — full code-change review

One button. The `deep-review` agent runs **all nine services at once**, spends
$0.30 (+$0.01 routing fee = $0.31), and returns every service's verdict.

The paying user is the **CI pipeline** — a real, non-subscription, pay-per-run business model. A repo that opens 200 PRs a month pays $26 and pays nothing on a quiet month. No seats, no API keys, no signup.

The console shows, live: nine 402 challenges → one group ID → nine txids on the
[Lora](https://lora.algokit.io/testnet) explorer → one receipt.

**Ten workflows** ship in total — `deep-review` (all 9 providers),
`pr-review` (4), `security-scan`, `bug-hunt` (2), `commit-polish`, and five
single-step toolbox workflows
(`generate-code`, `debug-error`, `write-tests`, `translate-text`,
`summarize-text`). `GET /v1/workflows` returns the live list.

## Quickstart

### Prerequisites

- **Node 22.18+** (the router runs `.ts` directly via Node's native type stripping), **pnpm 11**
- An Algorand Testnet account funded with ALGO ([Lora](https://lora.algokit.io/testnet/fund)) and test USDC ([Circle faucet](https://faucet.circle.com))
- Test USDC ASA opt-in on every provider payout address
- A [Neon](https://neon.tech) Postgres database and an [NVIDIA NIM](https://build.nvidia.com) API key

### Install

```bash
pnpm install
```

> **Packages (verified — see `docs/PROTOCOL.md` §1):** the track brief's `@x402/*`
> names are correct and used as-is at **2.21.0** (`@x402/core`, `@x402/avm`,
> `@x402/fetch`, `@x402/hono`). The hyphenated `@x402-avm/*` scope **does not apply**.
> Pin `zod@^3.24.2` (v4 breaks the SDK type boundary) and
> `@algorandfoundation/algokit-utils@10.0.0-alpha.46` exactly. `algosdk` is not a
> direct dependency.

### Environment

Copy your secrets into `.env` and `.env.accounts` (both gitignored).
Config is validated by Zod at boot — a missing/malformed var crashes the router
with a readable message rather than failing mid-demo.

```env
# ── Network (CAIP-2 is the genesis-hash form, NOT the string "algorand:testnet";
#    defaults are baked in from @x402/avm, so these are optional) ──
NETWORK=algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe
ALGOD_URL=https://testnet-api.algonode.cloud
INDEXER_URL=https://testnet-idx.algonode.cloud
USDC_ASA_ID=10458941
FACILITATOR_URL=https://facilitator.goplausible.xyz

# ── Provider payout addresses (58 chars each, all DISTINCT) ──
PAY_TO_DIFF=...
PAY_TO_GUARDRAIL=...
PAY_TO_ROASTER=...
PAY_TO_BUGSUM=...

# ── Provider endpoint URLs ──
PROVIDER_DIFF_URL=https://axis-diff-explainer.axis-pay.workers.dev
PROVIDER_GUARDRAIL_URL=https://axis-guardrail-checker.axis-pay.workers.dev
PROVIDER_ROASTER_URL=https://axis-commit-roaster.axis-pay.workers.dev
PROVIDER_BUGSUM_URL=https://axis-bug-summarizer.axis-pay.workers.dev
PROVIDER_TOOLBOX_URL=https://axis-toolbox.axis-pay.workers.dev   # optional (toolbox workflows)

# ── Router agent wallet + quote signing ──
AGENT_MNEMONIC=...            # the router custodies this and signs the group
QUOTE_SIGNING_KEY=...         # ≥32 chars; signs quotes so they can't be tampered

# ── Persistence + auth + model ──
DATABASE_URL=postgresql://...neon.tech/axis?sslmode=require
JWT_SECRET=...               # signs console session JWTs (off the money path)
NVIDIA_API_KEY=...           # NVIDIA NIM (LLM behind every provider + the agent)

# ── Policy defaults (microUSDC integers) ──
MAX_WORKFLOW_SPEND_MICRO=1000000     # $1.00
MAX_PROVIDER_SPEND_MICRO=500000      # $0.50
MAX_HOURLY_SPEND_MICRO=10000000      # $10.00
MAX_HOURLY_CALLS=100
MIN_PROVIDER_TRUST=50
KILL_SWITCH=false
```

> The **NVIDIA API key is set as a Worker secret** on each provider
> (`wrangler secret put NVIDIA_API_KEY`), never seen by the router. The router's
> own `NVIDIA_API_KEY` powers the autonomous agent's workflow choice.

### Run

```bash
# terminal 1 — router (quote · execute · receipt · SSE)  → :8080
cd backend/router && node src/index.ts

# terminal 2 — console  → :3000
cd frontend/console && NEXT_PUBLIC_ROUTER_URL=http://localhost:8080 npx next dev
```

The providers are already deployed to Cloudflare Workers (see `docs/DEPLOYED.md`);
the router calls them over HTTPS. To run a provider locally instead:
`cd backend/providers/diff-explainer && npx wrangler dev`. See `docs/RUN_LOCAL.md`.

### Deploy

Providers → **Cloudflare Workers** (`wrangler deploy`). Router → **Railway**
(Node 22 long-running process — *not* Vercel serverless, which caps execution
below the fan-out + LLM latency). Console → **Vercel**. Database → **Neon**.
See `docs/DEPLOYED.md`.

## API

> **Signing model:** the **router custodies the agent wallet** (`AGENT_MNEMONIC`)
> and produces the single group signature itself. Clients — the console, the SDK,
> the MCP server, the autonomous agent — only call HTTP and never touch a key.
> `execute` therefore takes **no `signedGroup`**; it takes a `quoteId`.

### `POST /v1/workflow/quote`

```json
{
  "workflow": "pr-review",
  "agentAddress": "NG5S…58CHARS",
  "inputs": { "diff": "- const t=10\n+ const t=60", "commitMessage": "bump timeout" }
}
```

Fans out unpaid probes, reads each provider's `402` price, resolves the DAG,
runs the spend guard, and returns `{ runId, quoteId, dag, legs[], subtotalUSDC,
routingFeeUSDC, totalUSDC, expiresAt, signature }` with a TTL. A policy `FAIL`
comes back as **HTTP 402** with the violated rule. **No payment occurs.**

### `POST /v1/workflow/execute`

Header: `Idempotency-Key: <uuid>` (a retry with the same key replays the stored
response — a CI pipeline can never double-pay).

```json
{ "quoteId": "...", "runId": "...", "chaos": "roast", "projectId": "..." }
```

Verifies + single-uses the quote, composes ONE atomic group across N payees,
simulates (hard gate), signs, settles via the facilitator, runs every provider
with its payment proof, refunds any paid-but-undelivered leg on-chain, and
returns `{ status, groupId, confirmedRound, txids[], … }`. `runId`/`projectId`
are optional; `chaos` is a demo flag that forces one leg to fail after payment.

### `GET /v1/receipt/:id` · `GET /v1/receipts`

The unified receipt — group ID, every txid, every provider result (full, no
truncation), per-step cost, total, status (`SETTLED` / `PARTIAL` / `FAILED`),
and any compensation txids. `/v1/receipts` lists every run from Neon, newest first.

### The rest of the surface

| Route | Purpose |
|---|---|
| `GET /v1/workflows` | the workflows an agent can run (id + provider steps + inputs) |
| `POST /v1/agent/run` | autonomous agent — `{ goal, budgetUSDC }` → picks a workflow, pays within budget, streams on a `runId` |
| `POST /v1/redteam/prime` · `POST /v1/redteam/:id` | fire the arXiv attacks (`replay`/`cross-resource`/`cache`) at our own live endpoints |
| `GET /v1/refunds` · `GET /v1/usage` | on-chain refunds; spend totals |
| `POST/GET /v1/projects` · `GET /v1/projects/:id` | group runs and see per-project spend |
| `POST /v1/auth/signup` · `POST /v1/auth/login` | JWT accounts (scrypt + HS256, `node:crypto` only) |
| `GET /v1/runs/latest` · `GET /v1/runs/:id/events` | latest run id; the live SSE event stream |
| `GET /healthz` · `GET /readyz` | liveness; readiness (every configured provider answers `/health`) |

> There is **no `/v1/policy` endpoint** and no generated `/openapi.json` in this
> build — the spend policy runs internally between quote and compose, and its
> full verdict (every rule + headroom) is returned inside the quote and streamed
> as a `policy.evaluated` SSE event.

## Beyond the core — the agent-facing layer

The router owns the wallet and the protocol; everything below is a thin,
key-free client on top of it (see `docs/FEATURES.md` for verification commands):

- **[`axis-pay`](https://www.npmjs.com/package/axis-pay) SDK** (`backend/sdk`,
  published on npm — `npm install axis-pay`) — zero-dependency drop-in: one
  `pay()` = quote → budget gate → atomic settle → receipt, or `runAgent(goal)`
  to skip picking a workflow entirely. Full docs: `backend/sdk/README.md`.
- **MCP server** (`backend/mcp`) — exposes `list_workflows` / `quote_workflow`
  / `pay_and_run` / `run_agent` / `create_project` / `list_projects` /
  `get_run_result` so Claude Desktop, Claude Code, Cursor, or any MCP agent
  can atomically pay N x402 APIs, or just hand it a plain-English task, natively
  as tools. Set `AXIS_API_KEY` and every call is scoped to your account — a
  task given to Claude shows up **live** in your own console (the Workflow
  page) and the Chrome extension. **Start here:
  [`docs/USING_WITH_CLAUDE.md`](docs/USING_WITH_CLAUDE.md)** — how to start the
  router, add your key, and what to type. Server details:
  `backend/mcp/README.md`.
- **Automatic project budgets** — give a project a `budgetUSDC` (console
  Projects page, `axis.createProject(name, budgetUSDC)`, or the `create_project`
  MCP tool) and every task tagged to it — from the console, the SDK, or an MCP
  agent — is capped automatically at whatever headroom is left. No project, or
  a project with no budget, still runs against the router's own spend-policy
  limits — the same backstop every run gets.
- **Autonomous budgeted agent** (`backend/agent`) — goal + USDC budget → an LLM
  picks the workflow and pays on its own, budget enforced twice (agent + guard).
- **Chrome live-monitor extension** (`extension/`) — a side-panel animated
  flowchart of the real stack with coins flowing on settle and back on refund;
  opens clean each time, never replaying a run that finished before you opened it.
- **Security hardening** — the three server-side attacks from *"Five Attacks on
  x402"* (resource binding, single-use claims, no-store caching) are mitigated
  and provable live on the console's **Start attack** page.

## How this maps to the judging criteria

| Weight | Criterion | Where AXIS delivers |
|---|---|---|
| **30%** | x402 Protocol Flow | Full 402 → sign → retry → settle → receipt executed **N times per workflow**, plus a distinct quote phase that reads challenges without paying. Every one of the brief's 8 steps is visible in the console. |
| **25%** | Real Pay-Per-Call Model | Paying user is the CI pipeline. Per-workflow-run pricing, no subscription, no seats. AXIS takes a routing fee per run. |
| **20%** | Technical Execution & Algorand | Native atomic transaction groups across multiple payees — an Algorand-specific capability, not a portable pattern. USDC ASA settlement, fee abstraction, `simulateTransactions` pre-flight, every txid surfaced in the response. |
| **15%** | Innovation & Utility | Multi-endpoint atomicity, unified receipts, and spend policy enforcement are the missing primitives between "x402 works" and "agents can actually use it." |
| **10%** | Documentation & Deployment | Live testnet endpoints, this README plus `ARCHITECTURE.md`, `PROTOCOL.md`, `FEATURES.md`, `DEPLOYED.md`, and `RUN_LOCAL.md`; mainnet-ready config (network is a single CAIP-2 constant). |

## Mainnet readiness

- Network selection is one CAIP-2 constant — testnet → mainnet is a config change.
- Facilitator supports mainnet Algorand today.
- Group size cap (16) is respected; larger workflows shard into sequential atomic batches with a shared workflow ID.
- Policy engine and receipt store are stateless-friendly and horizontally scalable.

## Roadmap

- Provider trust scoring from live indexer signals — settlement count, failure rate, refund history
- Bazaar/discovery extension integration for dynamic provider registration
- Cross-chain routing (Base, Solana) via the same facilitator
- Delegated allowances so agents run unattended under a standing budget

## Team

<!-- fill in -->

## License

MIT
