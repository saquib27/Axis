import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "./config.ts";
import { quotes, runs, legs, projects, spendEvents } from "./db/schema.ts";

const payer = "A".repeat(58);
let records = new Map<unknown, any[]>();
let writes: { table: unknown; value: any }[] = [];
let deletions: unknown[] = [];
let submitted = 0;
let simulateFails = false;
let settlementFails = false;
let deliveryFails = false;
let policyFails = false;
const database: any = {
  select: () => ({ from: (table: unknown) => {
    const query: any = { where: () => query, for: () => query, orderBy: () => query,
      then: (resolve: any) => Promise.resolve(records.get(table) ?? []).then(resolve) };
    return query;
  } }),
  update: (table: unknown) => ({ set: (value: any) => ({ where: () => ({
    returning: async () => [{ id: "quote" }],
    then: (resolve: any) => { writes.push({ table, value }); return Promise.resolve().then(resolve); },
  }) }) }),
  insert: (table: unknown) => ({ values: async (value: any) => { writes.push({ table, value }); } }),
  delete: (table: unknown) => ({ where: async () => { deletions.push(table); } }),
  execute: async () => {},
  transaction: async (fn: any) => fn(database),
};
mock.module("./db/client.ts", { namedExports: { db: () => database } });
mock.module("./engine/auth.ts", { namedExports: {
  accountForKey: async (key: string) => key === "owner" || key === "other" ? { id: key, email: `${key}@test.dev` } : null,
  signup: async () => ({}), login: async () => ({}),
} });
mock.module("./chain/client.ts", { namedExports: { agentAccount: () => ({ agent: { addr: payer }, algo: {} }) } });
mock.module("./engine/policy.ts", { namedExports: { evaluatePolicy: async () => ({ verdict: policyFails ? "FAIL" : "PASS", violations: ["hourly limit"], checks: [] }) } });
mock.module("./engine/quote.ts", { namedExports: { verifyQuoteSignature: () => true, buildQuote: async () => ({}), persistQuote: async () => {}, quoteToJson: () => ({}) } });
mock.module("./engine/compose.ts", { namedExports: { preflight: async () => {}, composeGroup: () => ({
  build: async () => ({ transactions: [{ txn: { txId: () => "tx-one" } }] }),
}) } });
mock.module("./engine/settle.ts", { namedExports: {
  simulate: async () => { if (simulateFails) throw new Error("simulation rejected"); },
  settleWithRetry: async () => { submitted++; if (settlementFails) throw new Error("response lost"); return { groupId: "group", txids: ["tx-one"], confirmedRound: 123 }; },
} });
mock.module("./engine/run.ts", { namedExports: { runWorkflow: async () => { if (deliveryFails) throw new Error("database unavailable after payment"); return { status: "SETTLED", refundedMicro: 0n }; } } });
const { createApp } = await import("./app.ts");
const { execute } = await import("./engine/execute.ts");
const { buildReceipt } = await import("./engine/receipt.ts");
const { reconcilePending } = await import("./reconcile.ts");
const cfg = { DATABASE_URL: "postgres://unused/test", NETWORK: "test", USDC_ASA_ID: "1", INDEXER_URL: "https://indexer.test" } as Config;

function reset() {
  records = new Map(); writes = []; deletions = []; submitted = 0;
  simulateFails = settlementFails = deliveryFails = policyFails = false;
  records.set(quotes, [{ id: "quote", apiKey: "owner", runId: "run-owned", workflow: "pr-review", agentAddress: payer,
    status: "OPEN", expiresAt: new Date(Date.now() + 60_000), legs: [{ stepId: "diff", provider: "diff-explainer", payTo: payer, priceMicro: "10", asset: "1", challenge: {} }],
    dag: {}, subtotalMicro: 10n, routingFeeMicro: 0n, totalMicro: 10n, policyVerdict: { verdict: "PASS" }, signature: "sig", inputs: {},
  }]);
}

for (const path of ["/v1/workflow/quote", "/v1/workflow/execute", "/v1/agent/run", "/v1/redteam/prime", "/v1/receipt/private", "/v1/runs/private/events"]) {
  test(`anonymous access is denied: ${path}`, async () => {
    reset(); const app = createApp(cfg);
    const response = await app.request(path, { method: path.includes("receipt") || path.endsWith("events") ? "GET" : "POST" });
    assert.equal(response.status, 401); assert.equal(submitted, 0);
  });
}
test("unknown API keys cannot start a run", async () => {
  reset(); const response = await createApp(cfg).request("/v1/agent/run", { method: "POST", headers: { "x-api-key": "bogus" } });
  assert.equal(response.status, 401);
});
test("direct-payment demos remain blocked for authenticated users", async () => {
  reset(); const response = await createApp(cfg).request("/v1/redteam/prime", { method: "POST", headers: { "x-api-key": "owner" } });
  assert.equal(response.status, 403); assert.equal(submitted, 0);
});
test("a foreign receipt's provider output is never returned", async () => {
  reset(); records.set(runs, [{ id: "private", apiKey: "owner" }]);
  assert.equal(await buildReceipt("private", cfg.DATABASE_URL, "other"), null);
});
test("a foreign quote cannot be executed", async () => {
  reset(); await assert.rejects(execute("quote", cfg, "injected-run", undefined, undefined, "other"), { code: "QUOTE_NOT_FOUND" });
  assert.equal(writes.length, 0); assert.equal(submitted, 0);
});
test("execute rechecks current policy before reserving or submitting", async () => {
  reset(); policyFails = true;
  await assert.rejects(execute("quote", cfg, "run", undefined, undefined, "owner"), { code: "POLICY_VIOLATION" });
  assert.equal(submitted, 0); assert.equal(writes.length, 0);
});
test("direct execute cannot exceed the project's remaining budget", async () => {
  reset(); records.set(projects, [{ id: "project", budgetMicro: 15n }]); records.set(runs, [{ spent: "10" }]);
  await assert.rejects(execute("quote", cfg, "run", undefined, "project", "owner"), { code: "POLICY_VIOLATION" });
  assert.equal(submitted, 0); assert.equal(writes.length, 0);
});
test("simulation failure releases the spend reservation", async () => {
  reset(); simulateFails = true;
  await assert.rejects(execute("quote", cfg, "run", undefined, undefined, "owner"));
  assert.equal(submitted, 0); assert.ok(deletions.includes(spendEvents));
  assert.ok(writes.some((w) => w.table === runs && w.value.status === "FAILED"));
});
for (const stage of ["settlement", "delivery"]) test(`${stage} failure retains spend and never claims zero cost`, async () => {
  reset(); settlementFails = stage === "settlement"; deliveryFails = stage === "delivery";
  await assert.rejects(execute("quote", cfg, "injected-run", undefined, undefined, "owner"), (error: any) => {
    assert.equal(error.code, "PAYMENT_RECOVERY_REQUIRED"); assert.equal(error.costedNothing, false); return true;
  });
  assert.equal(submitted, 1); assert.equal(deletions.length, 0);
  assert.ok(writes.some((w) => w.table === runs && w.value.status === "RECOVERY_REQUIRED"));
  const durableLegs = writes.find((w) => w.table === legs)!.value;
  assert.equal(durableLegs[0].txid, "tx-one"); assert.equal(durableLegs[0].runId, "run-owned");
});
test("reconciliation records confirmed but undelivered payments as partial", async () => {
  reset(); records.set(runs, [{ id: "run-owned", status: "RECOVERY_REQUIRED" }]);
  records.set(legs, [{ txid: "tx-one", status: "PAID", priceMicro: 10n }]);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ transaction: { "confirmed-round": 123, group: "group" } });
  try {
    assert.equal(await reconcilePending(cfg), 1);
    assert.ok(writes.some((w) => w.table === runs && w.value.status === "PARTIAL"));
  } finally { globalThis.fetch = oldFetch; }
});
test("reconciliation leaves an unknown payment reserved", async () => {
  reset(); records.set(runs, [{ id: "run-owned", status: "RECOVERY_REQUIRED" }]);
  records.set(legs, [{ txid: "tx-one", status: "SUBMITTING", priceMicro: 10n }]);
  const oldFetch = globalThis.fetch; globalThis.fetch = async () => new Response(null, { status: 404 });
  try { assert.equal(await reconcilePending(cfg), 0); assert.equal(writes.length, 0); assert.equal(deletions.length, 0); }
  finally { globalThis.fetch = oldFetch; }
});


test("EventSource query credentials authenticate but cannot read an unowned run", async () => {
  reset(); records.set(quotes, []); records.set(runs, []);
  const response = await createApp(cfg).request("/v1/runs/private/events?key=other");
  assert.equal(response.status, 404);
});

test("production router does not expose simulated runs", async () => {
  reset();
  const response = await createApp(cfg).request("/v1/demo/run", { method: "POST", headers: { "x-api-key": "owner" } });
  assert.equal(response.status, 404);
});
test("local preview keeps real payment routes disabled", async () => {
  reset();
  const response = await createApp(cfg, { paymentsEnabled: false }).request("/v1/workflow/execute", { method: "POST", headers: { "x-api-key": "owner" } });
  assert.equal(response.status, 503); assert.equal(submitted, 0);
});
