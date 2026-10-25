<img src="./logo.svg" alt="AXIS" width="72" align="right" />

# axis-pay

**Atomic multi-provider x402 payments on Algorand.** One call pays N paid APIs
in a single all-or-nothing group and returns one unified receipt.

[![npm](https://img.shields.io/npm/v/axis-pay.svg)](https://www.npmjs.com/package/axis-pay)

```bash
npm install axis-pay
```

Zero dependencies. Runs anywhere with global `fetch` (Node 18+, Bun, Deno,
Cloudflare Workers, the browser). **Holds no keys** — the router owns the agent
wallet and does the signing; this SDK never sees a mnemonic.

---

## Why

x402 solved the *single* paid API call. A real agent makes ten, to ten different
providers — which today means ten signatures, ten unrelated payments, and if
step four fails you have already paid for one, two and three. Money gone,
workflow dead, no result.

AXIS turns that into **one signature, one atomic Algorand group, one receipt**.
Either every provider is paid and every result comes back, or nothing settles
and the agent is out $0. Atomicity is a property of the chain (Algorand groups,
up to 16 transactions, all-or-nothing, ~3s finality), not of retry logic.

---

## Quick start

```ts
import { createAxisClient } from "axis-pay";

const axis = createAxisClient({
  routerUrl: "http://localhost:8080",
  apiKey: process.env.AXIS_API_KEY,   // optional — see "Your account key"
});

const receipt = await axis.pay(
  "deep-review",                       // 9 providers, one group
  { diff, commitMessage },
  agentAddress,
  { budgetUSDC: 0.5 },                 // hard ceiling — throws OVER_BUDGET before settling
);

console.log(receipt.status, receipt.totalUSDC);   // "SETTLED" "0.31"
for (const leg of receipt.legs) {
  console.log(leg.provider, leg.status, leg.explorerUrl);
}
```

Don't want to pick a workflow? Describe the task and let the router's LLM route
it — and refuse if nothing fits:

```ts
const { runId } = await axis.runAgent(
  "Review this diff and flag anything risky before merging.",
  { projectId: "proj_abc123" },
);
axis.onEvents(runId, (e) => console.log(e.type, e));
```

---

## API

| Call | Does |
|---|---|
| `createAxisClient({ routerUrl, apiKey?, token?, timeoutMs? })` | make a client |
| `listWorkflows()` | the workflows available, with each one's provider steps and required inputs |
| `quote(workflow, inputs, agentAddress)` | price it with **zero** payment; returns the signed quote + spend-policy verdict |
| `pay(workflow, inputs, agentAddress, opts?)` | quote → budget check → settle → **unified receipt** |
| `runAgent(goal, opts?)` | plain-English task → an LLM picks the workflow and pays, or refuses; returns `{ runId }` immediately |
| `getReceipt(runId)` | fetch a receipt (renders standalone, hours later) |
| `onEvents(runId, cb)` | subscribe to the live SSE event stream |
| `listProjects()` | projects with rolled-up spend, refunds and budget headroom |
| `createProject(name, budgetUSDC?)` | group runs under a project |

```ts
interface PayOptions      { budgetUSDC?: number; projectId?: string; chaosStep?: string }
interface AgentRunOptions { budgetUSDC?: number; projectId?: string }
```

### Errors

Every failure is an `AxisPayError` with a `.code` and a `.costedNothing` flag,
so you always know whether money moved:

| code | meaning | cost |
|---|---|---|
| `POLICY_BLOCKED` | the spend guard rejected it pre-signature | **$0** |
| `OVER_BUDGET` | quote exceeded your `budgetUSDC` | **$0** |
| `QUOTE_FAILED` | a provider never returned a 402 challenge | **$0** |
| `EXECUTE_FAILED` | settlement itself failed — check `.costedNothing` | varies |
| `RECEIPT_NOT_FOUND` | no such run | — |

```ts
try {
  await axis.pay("deep-review", inputs, addr, { budgetUSDC: 0.05 });
} catch (e) {
  if (e.code === "OVER_BUDGET") console.log("too expensive, paid nothing");
}
```

---

## What a receipt contains

One artifact per run — the thing you keep:

```ts
{
  receiptId: "run_ab12cd34ef56",
  status: "PARTIAL",              // SETTLED | PARTIAL | REVERSED | FAILED
  groupId: "7QP4…K2M9",           // the Algorand atomic group
  confirmedRound: 66171985,
  signatureCount: 1,              // always 1, whatever N is
  legs: [
    { provider: "diff-explainer", priceUSDC: "0.03", txid: "K7X2…",
      explorerUrl: "https://lora.algokit.io/testnet/transaction/K7X2…",
      status: "delivered", result: { … }, latencyMs: 276 },
    { provider: "bug-summarizer", priceUSDC: "0.05", status: "refunded",
      compensationTxid: "W8N1…", compensationExplorerUrl: "…" },
  ],
  totalUSDC: "0.31",
  refundedUSDC: "0.05",
}
```

**Payment atomicity is not delivery.** A provider can take the money and then
fail — so when one does, AXIS reverses that leg on chain, records the refund
txid in the same receipt, and marks the run `PARTIAL`. Nothing is left
unresolved.

---

## Automatic project budgets

Give a project a budget once and every `runAgent()` tagged to it is capped
automatically at whatever headroom is left — no per-call number:

```ts
const project = await axis.createProject("nightly-review", 2.00);   // $2.00 total
await axis.runAgent("Review this diff.", { projectId: project.id }); // capped at $2.00
await axis.runAgent("And this one.",     { projectId: project.id }); // capped at what's left
```

A project with no budget (or no `projectId` at all) has no ceiling of its own —
the router's own spend policy (per-workflow, per-provider, hourly spend,
velocity, provider trust, kill switch) is still enforced on every run either
way. There is no configuration in which spending is unbounded.

---

## Your account key

Pass `apiKey` and every call is scoped to your account: runs show up **live** in
the AXIS console's Workflow page and in the Chrome extension, and
`listProjects()` returns only yours. Find it in the console sidebar under your
email → **copy**.

Omit it and calls run unscoped — fine for local scripts and testing, but nothing
ties back to an account to watch.

---

## Live example

```bash
node example.ts          # quote only — zero payment
PAY=1 node example.ts    # settle a real atomic payment on Algorand testnet
```

## Design

- **Zero dependencies.** Talks HTTP to an AXIS router and nothing else.
- **Holds no keys.** The router owns the wallet and signs.
- **Types mirror the router**, so client and server can't drift.
- **Every price comes from the provider's own 402 challenge** — never hardcoded
  here, never hardcoded there.

MIT licensed. Part of [AXIS](../../README.md).
