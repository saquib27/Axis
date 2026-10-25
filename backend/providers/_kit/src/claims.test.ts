import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MemoryClaimStore, claimKey, paymentIdentity } from "./claims.ts";

describe("Attack II — replay / idempotency (arXiv:2605.11781 §3.2)", () => {
  test("the SAME payment can only be claimed ONCE", async () => {
    const store = new MemoryClaimStore();
    const key = claimKey("pay_abc", "/diff/explain");
    assert.equal(await store.claim(key, 900), true, "first use must succeed");
    assert.equal(await store.claim(key, 900), false, "replay must be refused");
  });

  test("1000 concurrent replays yield exactly ONE grant", async () => {
    // The paper measured 248 grants from 1000 concurrent replays of a single
    // payment against a live endpoint, with 1 on-chain settlement.
    const store = new MemoryClaimStore();
    const key = claimKey("pay_flood", "/diff/explain");
    const results = await Promise.all(
      Array.from({ length: 1000 }, () => store.claim(key, 900)),
    );
    assert.equal(results.filter(Boolean).length, 1, "DGR must be 1, not n");
  });

  test("resource binding: same payment cannot cross endpoints", async () => {
    // The paper found NO audited SDK binding payment to resource; a payment for
    // resource A worked on B, C and D of the same live server.
    const store = new MemoryClaimStore();
    assert.equal(await store.claim(claimKey("pay_x", "/diff/explain"), 900), true);
    // A different resource is a different claim slot — so the claim store alone
    // does NOT stop cross-resource reuse. The handler's resource-binding check
    // is what closes it, which is why they are two separate mitigations.
    assert.equal(await store.claim(claimKey("pay_x", "/bug/summarize"), 900), true);
  });

  test("distinct payments to the same resource both succeed", async () => {
    const store = new MemoryClaimStore();
    assert.equal(await store.claim(claimKey("pay_1", "/diff/explain"), 900), true);
    assert.equal(await store.claim(claimKey("pay_2", "/diff/explain"), 900), true);
  });
});

describe("payment identity — resists re-serialization", () => {
  test("key order does not change the identity", () => {
    // §3.2: hashing raw header BYTES lets a replay hide inside a re-encode.
    const a = paymentIdentity({ b: 2, a: 1, nested: { y: 2, x: 1 } });
    const b = paymentIdentity({ a: 1, b: 2, nested: { x: 1, y: 2 } });
    assert.equal(a, b, "reordered JSON is the SAME logical payment");
  });

  test("prefers an explicit payment id when present", () => {
    assert.equal(paymentIdentity({ payment_id: "pid_1", junk: 1 }), "pid_1");
  });

  test("derives identity from an AVM group + index", () => {
    const id = paymentIdentity({ paymentGroup: ["txn0", "txn1"], paymentIndex: 1 });
    assert.match(String(id), /^avm:1:txn1/);
  });

  test("two different AVM legs of one group are different payments", () => {
    const g = ["txn0", "txn1", "txn2"];
    assert.notEqual(
      paymentIdentity({ paymentGroup: g, paymentIndex: 1 }),
      paymentIdentity({ paymentGroup: g, paymentIndex: 2 }),
    );
  });

  test("rejects payloads with no derivable identity", () => {
    assert.equal(paymentIdentity(null), null);
    assert.equal(paymentIdentity("nonsense"), null);
  });
});
