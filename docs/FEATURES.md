# AXIS — Features & How to Verify Every One

**AXIS (Atomic X402 Integrated Settlement)** turns N paid x402 API calls into
**one all-or-nothing payment** on Algorand: one signature, one atomic group, one
receipt. Either every provider is paid and every result comes back, or nothing
settles and the agent is out **$0**.

This document lists everything built, and — for each feature — the **exact
command to prove it works**. Everything runs against **Algorand testnet** with
**real** payments and **real** LLM calls (NVIDIA NIM). No mocks in the money path.

---

## ⭐ Special features (added this session — the USP set)

These are the standout additions built on top of the core protocol. Each links
to its full verification steps further down.

| # | Feature | One-liner | Verify |
|---|---|---|---|
| **S1** | **Facilitator feePayer** | The atomic group settles through GoPlausible, which co-signs and funds the fee txn — the agent holds **no ALGO**, only USDC. | [A5](#a5-facilitator-feepayer--the-agent-needs-only-usdc-no-algo) — `SETTLE=1 node backend/scripts/spike-facilitator.ts` |
| **S2** | **`@axis/pay` SDK** | Zero-dependency drop-in client; one `pay()` call = quote → budget gate → atomic settle → receipt. | [C1](#c1-axispay-sdk--drop-in-client-backendsdk) — `PAY=1 node example.ts` |
| **S3** | **MCP server** | Exposes AXIS as MCP tools (`list_workflows / quote_workflow / pay_and_run`) so any AI agent (Claude Desktop, Cursor) can atomically pay N x402 APIs natively. | [C2](#c2-mcp-server--axis-as-a-tool-any-ai-agent-can-call-backendmcp) — `PAY=1 node test-client.ts` |
| **S4** | **Autonomous budgeted agent** | Goal + USDC budget → an LLM (NVIDIA NIM) picks the workflow, quotes, and pays on its own, with the budget enforced twice (agent + guard). | [C3](#c3-autonomous-budgeted-agent-backendagent) — `node src/cli.ts "..." 0.05` vs `1.00` |
| **S5** | **Chrome Live-Monitor extension** | A side-panel animated flowchart of the real stack (Cloudflare / NVIDIA / Neon / Algorand / GoPlausible) with **golden coins flowing on settle and back on refund**, a live backend terminal, and a final Receipt node. | [D3](#d3-chrome-extension--axis-live-monitor-extension) — load unpacked, run a workflow |
| **S6** | **JWT auth (signup / login)** | Plain email+password accounts (scrypt + HS256, `node:crypto` only — no third-party auth). Gates browsing receipts, never the money path. | [D2](#d2-jwt-auth-signup--login--backendrouter) — `/v1/auth/signup` + `/v1/auth/login` |
| **S7** | **All-receipts index + full results** | `GET /v1/receipts` lists every run from Neon; each receipt now shows the **complete** provider result (no 120-char truncation). | [A4](#a4-unified-receipt-with-full-results--all-receipts-from-db) — `curl /v1/receipts` |
| **S8** | **Red-team upgrade** | The replay attack pre-settles its payment in the background (`/prime`) so the click is ~2s not ~7s, plus a plain-language verdict and an inline diagram (1 payment → 12 copies → 1 served / 11 refused). | [B1](#b1-three-live-attacks-blocked-in-real-time) — prime → fire → `granted 1, blocked 11` |

---

## 0. One-time setup

```bash
pnpm install

# .env and .env.accounts must exist (gitignored) with:
#   AGENT_MNEMONIC, QUOTE_SIGNING_KEY, DATABASE_URL (Neon),
#   PAY_TO_DIFF / PAY_TO_GUARDRAIL / PAY_TO_ROASTER / PAY_TO_BUGSUM,
#   PROVIDER_DIFF_URL / _GUARDRAIL_URL / _ROASTER_URL / _BUGSUM_URL,
#   PROVIDER_TOOLBOX_URL (optional — the 5-service toolbox Worker),
#   NVIDIA_API_KEY, JWT_SECRET
```

**Start the router** (needed by almost every check below):

```bash
cd backend/router && node src/index.ts     # → http://localhost:8080
```

Sanity check:

```bash
curl -s localhost:8080/healthz             # {"ok":true}
curl -s localhost:8080/readyz              # {"ok":true} when all 4 providers answer
```

The agent address used in examples:
`NG5SZZ3U6XOB4L5N4CPZ7SLIZRDIEK2CM4XMB5WDPLAWSCIRCIJTTKYOPQ`

---

## PART A — Core protocol (the submission)

### A1. Atomic multi-provider x402 — quote → settle → receipt

**What:** four independent x402 providers priced from their own `402`
challenges, composed into ONE Algorand atomic group, settled with ONE signature.

**Verify:**
```bash
# 1) Quote — ZERO payment, price read from each provider's live 402
curl -s -X POST localhost:8080/v1/workflow/quote \
  -H 'content-type: application/json' \
  -d '{"workflow":"pr-review","agentAddress":"NG5SZZ3U6XOB4L5N4CPZ7SLIZRDIEK2CM4XMB5WDPLAWSCIRCIJTTKYOPQ","inputs":{"diff":"- const t=10\n+ const t=60","commitMessage":"bump timeout"}}'
# → { quoteId, totalUSDC:"0.14", legs:[4 providers with prices], policy:{verdict:"PASS"} }

# 2) Execute — settles ONE atomic group, returns 4 txids to 4 different payees
curl -s -X POST localhost:8080/v1/workflow/execute \
  -H 'content-type: application/json' -H 'Idempotency-Key: demo-1' \
  -d '{"quoteId":"<quoteId from step 1>"}'
# → { status:"SETTLED", groupId, confirmedRound, txids:[4] }
```
**Pass criteria:** one `groupId`, four `txids` to four **different** addresses, all
clickable on the [Lora](https://lora.algokit.io/testnet) explorer; the whole
workflow used **one** signature.

> **Scope note:** the four `pr-review` providers are the multi-payee core, but the
> build ships **nine paid endpoints across five Workers** (the `toolbox` Worker adds
> `/code/generate`, `/debug/fix`, `/test/write`, `/translate`, `/summarize`) and
> **nine workflows** total. `GET /v1/workflows` returns the live list.

---

### A2. Compensation / PARTIAL — payment atomicity ≠ execution atomicity

**What:** if a provider takes payment but fails to deliver, its leg is
**reversed on-chain** and the run is marked `PARTIAL`.

**Verify (chaos flag forces one provider to fail after payment):**
```bash
# quote first (as A1), then:
curl -s -X POST localhost:8080/v1/workflow/execute \
  -H 'content-type: application/json' \
  -d '{"quoteId":"<quoteId>","chaos":"roast"}'
# → status:"PARTIAL", refundedUSDC > 0, the roast leg COMPENSATED with a refund txid
```
Or use the console **Test failure** page. **Pass criteria:** run is `PARTIAL`, the
failed leg has a `compensationTxid` confirmed on-chain, `refundedUSDC` is correct.

---

### A3. Spend Policy Guard — a FAIL means nothing is signed

**What:** six rules (ceiling, per-provider cap, hourly velocity, trust,
kill-switch, client budget) evaluated **between quote and compose**.

**Verify:**
```bash
curl -s localhost:8080/v1/policy          # current ceilings
# A quote whose total exceeds MAX_WORKFLOW_SPEND_MICRO returns 402 with
# policy.verdict:"FAIL" and NO group is ever built (zero chain calls).
```
**Pass criteria:** a blocked quote returns `402` + the violated rule; balances unchanged.

---

### A4. Unified receipt (with full results) + all receipts from DB

**What:** one receipt per run — group id, all txids, per-leg status, totals,
refunds, **and the full provider results**.

**Verify:**
```bash
curl -s localhost:8080/v1/receipt/<runId>    # single receipt, renders standalone
curl -s localhost:8080/v1/receipts           # every run in the DB, newest first
```
In the console: **Receipts** page lists all runs from the DB; each opens a receipt
showing the **complete** LLM result per provider (no truncation).
**Pass criteria:** `/v1/receipt/:id` returns every leg with `result` populated and
working explorer links; `/v1/receipts` lists your past runs.

---

### A5. Facilitator feePayer — the agent needs only USDC, no ALGO

**What:** the atomic group settles through GoPlausible's facilitator, which
co-signs and funds the fee-payer transaction — so the agent holds **no ALGO**.

**Verify:**
```bash
node backend/scripts/spike-facilitator.ts           # /verify → isValid:true (multi-payee)
SETTLE=1 node backend/scripts/spike-facilitator.ts  # /settle → success:true + real txid
```
**Pass criteria:** `/verify` returns `isValid:true` and `/settle` returns
`success:true` with a txid — the agent signed only its USDC legs.

---

## PART B — Security (Start Attack)

### B1. Three live attacks, blocked in real time

**What:** the three attacks from arXiv:2605.11781 that hit any x402 server,
fired at our OWN live endpoints and bounced.

**Verify (each is a real request against a live Cloudflare Worker):**
```bash
# Replay: pre-settle a real payment, then fire 12 identical copies at once
PROOF=$(curl -s -X POST localhost:8080/v1/redteam/prime | sed 's/.*"proof":"//;s/".*//')
curl -s -X POST localhost:8080/v1/redteam/replay \
  -H 'content-type: application/json' -d "{\"proof\":\"$PROOF\"}"
# → fired 12, granted 1, blocked 11   (served ONCE, 11 copies refused)

curl -s -X POST localhost:8080/v1/redteam/cross-resource   # → blocked: RESOURCE_MISMATCH
curl -s -X POST localhost:8080/v1/redteam/cache            # → blocked: no-store + Vary
```
Or the console **Start attack** page: click **fire attack** (~2s each) and read the
verdict + the diagram (1 payment → 12 copies → 1 served / 11 refused).
**Pass criteria:** replay = 1 granted / 11 blocked; cross-resource and cache both blocked.

> **Latency note:** the replay click is ~2s because the real on-chain payment is
> pre-settled in the background (`/v1/redteam/prime`) when the page loads.

---

## PART C — Agent-facing layer (the USP)

> The narrative: **any AI agent can atomically pay multiple x402 providers,
> safely within a budget, in one signature.** The router owns the wallet and
> signs — none of C1–C3 ever touch a private key; they only call HTTP.

### C1. `@axis/pay` SDK — drop-in client (`backend/sdk`)

**What:** zero-dependency client. `pay()` = quote → budget gate → settle → receipt.

**Verify:**
```bash
cd backend/sdk
node example.ts            # quote only — ZERO payment
PAY=1 node example.ts      # settle a REAL atomic payment on testnet
# → SETTLED · $0.13 · group … · 4 DELIVERED legs with explorer links
```
**Pass criteria:** quote prints 4 priced legs + policy PASS; `PAY=1` prints a
SETTLED receipt with four real txids.

---

### C2. MCP server — AXIS as a tool any AI agent can call (`backend/mcp`)

**What:** exposes `list_workflows`, `quote_workflow`, `pay_and_run` over MCP
(stdio), so Claude Desktop / Cursor can pay N x402 APIs natively.

**Verify (spawns the server over stdio, lists tools, calls them):**
```bash
cd backend/mcp
node test-client.ts          # discovery + quote (no payment)
PAY=1 node test-client.ts    # also calls pay_and_run → real SETTLED group + results
```
**Verify in Claude Desktop:** add the block from `backend/mcp/README.md` to
`claude_desktop_config.json`, restart, then ask *"List AXIS workflows, then pay and
run pr-review on this diff with a $0.50 budget."*
**Pass criteria:** `test-client.ts` prints the three tool names, a quote, and (with
`PAY=1`) a SETTLED result carrying all four providers' outputs.

---

### C3. Autonomous budgeted agent (`backend/agent`)

**What:** goal + USDC budget → an LLM (NVIDIA NIM) picks the workflow and fills
inputs → quote → **budget gate** → pay → summarise. Budget enforced twice (agent
declines over-budget; the router's guard is the hard backstop).

**Verify (both paths):**
```bash
cd backend/agent
node src/cli.ts "Review this PR: - const t=10 / + const t=60" 0.05   # → DECLINES (over budget)
node src/cli.ts "Review this PR: - const t=10 / + const t=60" 1.00   # → SETTLED $0.13
```
**Pass criteria:** `$0.05` prints `paid: false · quote $0.14 exceeds budget`;
`$1.00` prints `SETTLED` with four DELIVERED legs.

---

## PART D — Console & tooling

### D1. Web console (Next.js 15)

A marketing **landing page** at `/`, then the dashboard: **Run workflow**
(`/dashboard`), **Autonomous agent**, **Test failure**, **Start attack**,
**Receipts**, **Refunds**, **Projects**, **How it works**, plus **Login / Sign up**.

**Verify:**
```bash
cd frontend/console && NEXT_PUBLIC_ROUTER_URL=http://localhost:8080 npx next dev   # → :3000
```
Open `/` for the landing, then `/dashboard` → run a workflow → the full flow streams
live via SSE. (If the router is offline, the Run page falls back to a mock stream so
the UI still animates.)

---

### D2. JWT auth (signup / login) — `backend/router`

**What:** plain JWT accounts (scrypt + HS256, `node:crypto` only — no third-party
auth). Gates browsing receipts, never the money path.

**Verify:**
```bash
curl -s -X POST localhost:8080/v1/auth/signup \
  -H 'content-type: application/json' -d '{"email":"you@axis.dev","password":"password123"}'
# → { token, user }
curl -s -X POST localhost:8080/v1/auth/login \
  -H 'content-type: application/json' -d '{"email":"you@axis.dev","password":"password123"}'
# → { token }; wrong password → 401; duplicate signup → 409
```

---

### D3. Chrome extension — AXIS Live Monitor (`extension/`)

**What:** a side-panel that turns a run into a **live animated flowchart** —
branded boxes (Cloudflare, NVIDIA, Neon, Algorand, GoPlausible), **golden coins
that flow along the arrows** on settle and **race back on a refund**, a **live
backend terminal**, and a final **Receipt** node that every provider records into.

**Verify:**
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `extension/`.
2. Start the router, click the AXIS toolbar icon (side panel opens, auto-follows via `GET /v1/runs/latest`).
3. Run a workflow in the console → watch the flowchart animate + the terminal tail every event.

**Pass criteria:** boxes light up in order, coins flow to 4 providers on settle,
the receipt node turns green (SETTLED) / amber (PARTIAL); a Test-failure run shows
coins going backward and the receipt still created.

---

## Full-stack smoke test (everything at once)

```bash
# Terminal 1 — router
cd backend/router && node src/index.ts

# Terminal 2 — prove the whole chain in ~30s
cd backend/sdk   && PAY=1 node example.ts          # SDK settles
cd backend/mcp   && PAY=1 node test-client.ts      # MCP settles via tool
cd backend/agent && node src/cli.ts "review PR" 1.00   # agent settles autonomously
node backend/scripts/spike-facilitator.ts    # facilitator /verify passes
```

---

## What's done vs not

| Area | Status |
|---|---|
| Core: atomic multi-provider x402, quote→settle→receipt | ✅ live |
| Compensation / PARTIAL (on-chain refund) | ✅ live |
| Spend Policy Guard (6 rules) | ✅ live |
| Unified receipt + full results + all-receipts list | ✅ live |
| Facilitator feePayer (agent needs no ALGO) | ✅ proven (`/verify` + `/settle`) |
| Red-team: 3 live attacks + diagram, ~2s | ✅ live |
| `@axis/pay` SDK | ✅ tested |
| MCP server | ✅ tested |
| Autonomous budgeted agent | ✅ tested |
| Console + JWT auth + Chrome live-monitor extension | ✅ done |
| Providers deployed to Cloudflare Workers (9 endpoints / 5 Workers) | ✅ live |
| Landing page + console visual design | ✅ in progress |
| **P9 deploy** (router → Railway, console → Vercel) | ❌ the one remaining gap |

**Housekeeping:** rotate the NVIDIA + Neon credentials that were shared in chat.
