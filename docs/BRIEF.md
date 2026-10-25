# AXIS — Atomic X402 Integrated Settlement

**One line:** AXIS turns *N* paid x402 API calls into **one all-or-nothing
payment** on Algorand — one signature, one atomic group, one receipt — so an AI
agent either gets every result and pays everyone, or settles nothing and is out
**$0**.

---

## The problem

x402 (HTTP 402 "Payment Required") solved the **single** paid API call: an agent
hits an endpoint, gets a `402` with a price, pays, and gets the response. That
works for *one* call.

But real AI agents don't make one call — they make **ten**, to **ten different
providers** (explain this diff, check it for bugs, write tests, summarise, …).
With per-call x402 that means:

- **Ten signatures and ten unrelated payments.** Nothing ties them together.
- **No atomicity.** If step 4 fails, you've *already paid* for steps 1, 2 and 3.
  Money gone, no usable result.
- **No refund when a paid provider doesn't deliver.** Paying on-chain and getting
  the service are two different things, and nobody handles the gap.
- **No unified accounting.** Ask a per-call system "what did this one task cost
  me" and it can't tell you.

Per-call payments **don't compose** — and agentic workflows are nothing but
composition.

## The solution — AXIS on Algorand

AXIS is an x402 **aggregator + settlement layer**. It fans out to N providers,
reads each one's price from its own `402`, and settles them as **one atomic
transaction group**:

1. **Discover & quote (zero payment).** Unpaid probes to every provider; the
   price comes from each provider's live `402`, never hardcoded.
2. **Spend Policy Guard.** Six rules (ceiling, per-provider cap, hourly velocity,
   trust, kill-switch, client budget). A **FAIL means nothing is ever signed.**
3. **Compose one atomic group** — N USDC payments to N **distinct** payees.
4. **Simulate first** (`simulateTransactions`) — a free dry run; a bad group
   **never submits**, so a failed pre-flight costs the agent nothing.
5. **One signature** authorizes the whole group.
6. **Settle** — all-or-nothing on chain (~3s), with the **facilitator as fee
   payer**, so the agent needs only **USDC, no ALGO**.
7. **Execute + compensate.** Payment atomicity ≠ execution atomicity: if a
   provider takes payment but fails to deliver, AXIS **reverses that leg on
   chain** (a real refund txn) and marks the run `PARTIAL`.
8. **Unified receipt** — one group id, N txids, per-leg status, total, refunds.

## Why Algorand (this is the thesis)

- **Atomic transaction groups are native.** Up to 16 transactions commit
  all-or-nothing with no smart contract, no escrow, no refund queue. On most
  chains "atomic across N providers" means building a payment processor; on
  Algorand **atomicity is a property of the chain, not of our code.**
- **Deterministic ~3s finality, no reorgs.** The x402 attacks that rely on
  probabilistic settlement / chain reorgs (revert-grant) **structurally cannot
  exist** here.
- **Free pre-flight** via `simulateTransactions`.
- **Facilitator fee abstraction** — the agent holds only USDC.

## What we built (a product, not just a demo)

- **Multi-payee atomic settlement** — flagship `deep-review`: **7 providers,
  7 distinct payees, one signature**, proven live on testnet.
- **On-chain compensation / refunds** for any provider that doesn't deliver.
- **Spend Policy Guard** (6 rules) between quote and signing.
- **Facilitator feePayer** — proven live (`/verify` + `/settle`); agent needs no ALGO.
- **Agent-facing layer:**
  - `axis-pay` **SDK** (zero-dep, npm-ready) — one `pay()` call.
  - **MCP server** — Claude Desktop / Cursor can atomically pay N x402 APIs natively.
  - **Autonomous budgeted agent** — give it a goal + USDC budget; it decides,
    quotes, and pays, refusing anything it can't actually do.
- **9 services / workflows** — code review, security scan, bug hunt, code-gen,
  debug, tests, translate, summarise.
- **Projects, refunds, usage** dashboards + **JWT auth**.
- **Chrome "Live Monitor" extension** — an animated flowchart (Cloudflare, NVIDIA,
  Neon, Algorand, GoPlausible) with gold coins flowing on settle and back on
  refund, plus a live backend terminal.
- **Auto-retry** settlement (2 attempts, then stop — never double-pays).

## Security

We read the one paper that breaks x402 (arXiv:2605.11781) and fixed the **three
attacks that apply to any x402 server** — replay/idempotency (single-use claim in
a Durable Object), cross-resource replay (resource binding), and cache leakage
(`no-store` + `Vary`). Each fires **live** against our own endpoints and bounces.
The other two attacks need Ethereum's probabilistic settlement and cannot exist
on Algorand — which ties the security story directly to the chain choice.

## Tech stack

x402 (`@x402/core|avm|fetch|hono`) · Algorand testnet + USDC ASA · GoPlausible
facilitator · Cloudflare Workers (providers) + Durable Objects (replay
protection) · NVIDIA NIM (LLM) · Neon Postgres + Drizzle · Next.js console ·
Chrome extension · TypeScript monorepo.

## Status

Full loop is **live on Algorand testnet** — quote → guard → simulate → one
signature → atomic settle → execute → compensate → unified receipt, with real
payments and real LLM calls (no mocks in the money path). The only remaining step
is production **deployment** (router → Railway, console → Vercel; providers are
already on Cloudflare).
