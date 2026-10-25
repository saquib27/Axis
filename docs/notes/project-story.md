# AXIS — The Whole Story

*A plain-language walkthrough of everything we built, every file, every service,
and how it all fits together. Read this and you understand the whole system.*

---

## Part 1 — The story, told simply

Imagine an AI agent whose job is to review a pull request. To do it well, it
needs four different paid services:

- one **explains the code diff** — 3¢
- one **checks the text for prompt-injection attacks** — 2¢
- one **critiques the commit message** — 3¢
- one **turns the bug report into repro steps** — 5¢

Four different companies own those four services. Total: **13¢ per review.**

Now the hard question: *how does the agent pay them?*

Today it pays each one separately — four payments, four signatures, four
receipts. And here's the part that hurts:

> It pays service 1, 2, and 3. Then service 4 is down.
> **You've spent 8¢ and got nothing usable. Money gone.**

That's the gap. Individual payments work; **together they're fragile.**

**AXIS fixes this.** It sits between the agent and the four services and turns
four payments into **one all-or-nothing payment** on Algorand:

```
   agent ──▶ AXIS ──┬──▶ diff explainer     3¢
                    ├──▶ guardrail checker  2¢
                    ├──▶ commit roaster     3¢
                    └──▶ bug summarizer     5¢

        ONE signature · ONE atomic group · ONE receipt · 13¢
```

Either **everyone** gets paid and **every** result comes back, or **nothing**
settles and the agent is out **zero**. And if a service takes the money and then
dies, AXIS **sends the money back on chain**.

---

## Part 2 — The map (how the pieces talk)

```
 ┌────────────────────────────────────────────────────────────────────┐
 │                         YOUR BROWSER                                 │
 │   The CONSOLE (Next.js)  —  frontend/console/                        │
 │   • one button: "Should I merge this PR?"                            │
 │   • watches the whole thing happen live                             │
 └───────────────┬──────────────────────────────▲─────────────────────┘
                 │ quote / execute (HTTP)        │ live events (SSE)
                 ▼                               │
 ┌────────────────────────────────────────────────────────────────────┐
 │              THE ROUTER (Node.js)  —  backend/router/                │
 │   the brain. does everything in order:                              │
 │   quote → policy → compose → simulate → sign → settle → run → refund │
 └───┬───────────────┬────────────────────┬──────────────────┬─────────┘
     │ 402 challenges │ read/write         │ settle the       │ paid retries
     │ + paid calls   │ receipts           │ atomic group     │ (get results)
     ▼                ▼                    ▼                  ▼
 ┌─────────────┐ ┌──────────┐ ┌────────────────────┐ ┌──────────────────┐
 │ 4 PROVIDERS │ │  NEON    │ │  ALGORAND TESTNET  │ │  x402 FACILITATOR │
 │ Cloudflare  │ │ Postgres │ │  USDC · atomic     │ │  GoPlausible      │
 │ Workers     │ │ receipts │ │  groups · ~3s      │ │  (hosted)         │
 │ + NVIDIA AI │ │ quotes   │ │  finality          │ │                   │
 │ + KV + DO   │ │ policy   │ │                    │ │                   │
 └─────────────┘ └──────────┘ └────────────────────┘ └──────────────────┘
```

---

## Part 3 — Every service we use, and why

| Service | What it is | Why we use it | Where it shows up |
|---|---|---|---|
| **Algorand** | A blockchain | Its **atomic groups** let us pay 4 people all-or-nothing with no smart contract. ~3s finality. This is the whole reason the project works. | `backend/router/src/chain/`, `engine/compose.ts`, `settle.ts` |
| **USDC (testnet)** | A dollar-stablecoin, issued by Circle | The actual money providers get paid in. Fake dollars on testnet. | everywhere money moves |
| **Cloudflare Workers** | Tiny always-on servers | Hosts the 4 paid provider endpoints. Free, instant, never sleeps. | `backend/providers/*` |
| **Cloudflare KV** | A simple key-value store on Workers | Remembers which payments were already used (stops replay). | `providers/_kit/src/claims.ts` |
| **Cloudflare Durable Object** | A single, globally-unique mini-server | The *correct* replay guard: serializes concurrent requests so a payment can be used exactly once even under a 12-way flood. | `providers/_kit/src/claims.ts` (`ClaimDO`) |
| **NVIDIA NIM** | A hosted AI model API (`llama-3.1-8b`) | The actual "work" each provider does — explains diffs, checks text, etc. | `providers/_kit/src/llm.ts` |
| **Neon** | A free hosted Postgres database | Stores quotes, runs, receipts, spend history — so a receipt survives a restart. | `backend/router/src/db/` |
| **GoPlausible facilitator** | A hosted x402 payment verifier | The official x402 facilitator for Algorand — verifies/settles payments, offers fee abstraction. | `providers/_kit/src/x402.ts` |
| **Vercel / Railway** | Deploy hosts (planned) | Where the console and router go live for the demo. | Phase 9 |
| **GitHub** | Code hosting | The repo; everyone's branches. | `Dushyant-web/ASIX` |

---

## Part 4 — Every folder, what it does

```

├── backend/
│   ├── shared/         THE VOCABULARY — everything else imports this
│   ├── guard/          THE SPEND POLICE — the 6 spending rules
│   ├── router/         THE BRAIN — the whole engine
│   ├── providers/      THE 4 PAID SHOPS — on Cloudflare
│   ├── receipts/       (receipt helpers)
│   └── scripts/        testnet account + spike tooling
├── frontend/
│   └── console/        THE DASHBOARD — what you watch
└── docs/               protocol facts, deploy notes, run guide
```

### `backend/shared/` — the vocabulary

Zero networking. Just definitions everything agrees on. If two parts of the
system disagree about what a "quote" is, nothing works — so it all lives here,
once.

| File | Plain meaning |
|---|---|
| `money.ts` | **Money is always whole numbers of micro-dollars** (bigint), never decimals. `$0.13` = `130000`. This makes the classic `0.1 + 0.2 ≠ 0.3` bug **impossible**. |
| `constants.ts` | Network IDs, the USDC asset ID, the 16-transaction group cap. Re-exported from the real SDK so we never mistype a genesis hash. |
| `errors.ts` | Every failure is a typed code. Each one says whether it **cost the agent anything** (`costedNothing`). |
| `schemas/*.ts` | The shapes: workflow, quote, receipt, policy. Written once, used by backend AND frontend, so they can't drift. |
| `schemas/events.ts` | **The live event contract.** Every moment of a run is one of these events. This is what makes the dashboard animate. |
| `dag/resolve.ts` | Figures out which providers can run **at the same time** vs which must wait (bug-summarizer needs the diff first). |
| `dag/interpolate.ts` | Plugs one step's output into another's input at run time. Rule: a missing value **throws**, never becomes garbage — a paid provider must never get junk. |
| `fixtures/mock-run.ts` | A fake-but-realistic run, so the frontend could be built before the backend existed. |

### `backend/guard/` — the spend police

Pure logic. Six rules that run **before any signature**, so a violation costs
zero: kill switch, per-workflow ceiling, per-provider cap, hourly spend limit,
hourly call limit, provider trust. Every rule reports headroom, so the dashboard
can show budget bars.

### `backend/router/` — the brain

This is the engine. It runs the whole 8-step protocol in order.

| File | Plain meaning |
|---|---|
| `app.ts` | The web server. Defines the endpoints: `/quote`, `/execute`, `/receipt`, the live event stream, and the `/redteam` attack endpoints. |
| `index.ts` | Boots the server. On startup, **reconciles** any run left half-finished by a crash. |
| `config.ts` | Reads all the settings and **crashes at startup** if anything's missing — never a mystery failure mid-demo. |
| `engine/quote.ts` | Asks all 4 providers "what do you cost?" (reads their 402), adds it up, signs the quote. **No money moves.** |
| `engine/policy.ts` | Runs the spend guard; one fast database query for the hourly velocity. |
| `engine/compose.ts` | Builds the ONE atomic group — 4 payments to 4 different addresses. Checks everyone's opted into USDC first. |
| `engine/settle.ts` | The dry-run (simulate) gate, then submits the group. A group that fails simulation is **never submitted**. |
| `engine/execute.ts` | Ties it together: load quote → verify → mark used → compose → simulate → sign → settle → then run the providers. |
| `engine/run.ts` | Calls each provider **with proof of payment**, gets real AI results, and **refunds on chain** any provider that took money and failed. |
| `engine/receipt.ts` | Builds the one unified receipt from the database. |
| `engine/redteam.ts` | Fires the 5 attacks at our own endpoints to prove they're blocked. |
| `chain/client.ts` | Connects to Algorand with the agent's wallet. |
| `db/schema.ts` | The 6 database tables. |
| `bus.ts` | The live event pipe — the router emits events, the browser listens. |
| `middleware/idempotency.ts` | A retry with the same key **doesn't pay twice**. |
| `middleware/ratelimit.ts` | Caps requests per caller. |
| `reconcile.ts` | On boot, finishes any run a crash interrupted. |

### `backend/providers/` — the 4 paid shops

Each is a tiny server on Cloudflare that: asks for money (402), verifies the
payment, then does real AI work. All four share one toolkit.

| File | Plain meaning |
|---|---|
| `_kit/src/x402.ts` | Issues the "402 Payment Required" challenge; the price lives HERE, not in the router. |
| `_kit/src/handler.ts` | The pipeline: **the order is the security**. challenge → check input → resource-bind → **claim (single-use)** → verify → do work → no-store. |
| `_kit/src/claims.ts` | Stops replay. In-memory + KV + **Durable Object** (the DO is what blocks a concurrent flood — one payment used exactly once). |
| `_kit/src/onchain.ts` | After the group settles, each provider confirms its payment **on the chain** via the indexer. |
| `_kit/src/llm.ts` | Calls NVIDIA. Validates the JSON and retries once if the model returns junk. |
| `diff-explainer/`, `guardrail-checker/`, `commit-roaster/`, `bug-summarizer/` | The 4 shops — a prompt each, on 4 different payout addresses. |

### `frontend/console/` — the dashboard

What you watch. **UX structure only right now — no colors** (the team styles it).

| File | Plain meaning |
|---|---|
| `lib/state-machine.ts` | **The most important frontend file.** Takes the live events and turns them into what's on screen. Pure, tested — the UI can never lie about the protocol. |
| `lib/api.ts` | The only place that talks to the router. |
| `lib/useRunStream.ts` | Subscribes to the live event stream; reconnect-safe. |
| `components/RunView.tsx` | The reusable pieces: 8-step rail, provider graph, group panel, receipt table, event log. |
| `components/Sidebar.tsx` | The left nav connecting every page. |
| `app/page.tsx` | **Run workflow** — the main demo. |
| `app/failure/page.tsx` | **Test failure** — force a provider to fail, watch the refund on chain. |
| `app/attack/page.tsx` | **Start attack** — fire the 5 attacks, see them blocked. |
| `app/receipts/`, `app/protocol/` | Look up a receipt; explain the 8 steps. |

---

## Part 5 — What happens when you click the button (step by step)

```
CLICK "Should I merge this PR?"
   │
   1. DISCOVER   router asks all 4 providers "what do you cost?"   (no money)
   2. CHALLENGE  each replies 402 with its price                  (no money)
   3. QUOTE      router adds it up ($0.14), signs a quote          (no money)
   4. POLICY     spend guard checks ceilings & limits             (no money)
   ─────────────────────────  if any check fails, STOP here, cost = $0  ───
   5. COMPOSE    router builds ONE group: 4 payments, 4 addresses
   6. SIMULATE   free dry-run — if it would fail, STOP, cost = $0
   7. SIGN       ONE signature authorizes the whole thing
   8. SETTLE     the group commits all-or-nothing in ~3 seconds
   │
   then: router calls each provider WITH proof → gets real AI answers
   │
   if a provider took money and failed → REFUND it on chain, mark PARTIAL
   │
   RECEIPT: group id · 4 txids · 4 results · total · any refunds
```

Everything up to step 7 is **free to fail**. That's the promise.

---

## Part 6 — The two things that make us win

**1. Refunds when a provider takes money and fails.**
Everyone else stops at "the payment worked." But payment succeeding is not the
same as the service being delivered. AXIS detects a provider that took money and
died, and **sends the money back on chain** with a real refund transaction.
See it on the **Test failure** page.

**2. We're hardened against the only paper that breaks x402.**
A research paper ("Five Attacks on x402", arXiv:2605.11781) documents five ways
to break x402 servers — and found all the official SDKs vulnerable. We read it,
fixed the three that apply to any server, and can prove it **live** on the
**Start attack** page. The hardest one — concurrent replay — needed a Durable
Object to block properly, and now a 12-way flood yields exactly 1 grant.
The other two attacks target Ethereum's settlement model; Algorand's design
means they can't exist here — which ties the security story straight into *why
we chose Algorand.*

---

## Part 7 — The one-sentence pitch

> **Everyone else built an agent that pays for things. We built the thing that
> lets any agent pay ten services at once — atomically, one signature, one
> receipt — get its money back when a provider fails, and shrug off the five
> known attacks on x402. On Algorand, because on Algorand it's clean.**
