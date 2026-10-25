import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mockRunSync } from "@axis/shared";
import {
  applyAll, initialRunView, applyEvent, settledTxids, refundedNodes,
  outcomeHeadline, isTerminal,
} from "./state-machine.ts";

describe("state machine — happy path", () => {
  const v = applyAll(mockRunSync("happy"));

  test("ends SETTLED with all 8 protocol steps done", () => {
    assert.equal(v.status, "SETTLED");
    assert.equal(v.protocol.filter((p) => p.status === "done").length, 8);
  });

  test("four txids to four DISTINCT payees", () => {
    const tx = settledTxids(v);
    assert.equal(tx.length, 4);
    assert.equal(new Set(tx.map((n) => n.payTo)).size, 4);
  });

  test("exactly ONE signature — the whole thesis", () => {
    assert.equal(v.group.signatureCount, 1);
  });

  test("every node ends delivered, with a real preview", () => {
    for (const n of Object.values(v.nodes)) {
      assert.equal(n.state, "delivered", `${n.stepId} should be delivered`);
      assert.ok(n.preview && n.preview.length > 0);
    }
  });

  test("keeps the verbatim 402 challenge for each provider", () => {
    for (const n of Object.values(v.nodes)) {
      assert.ok(n.challenge, `${n.stepId} must retain its raw 402`);
    }
  });

  test("DAG batches preserved: 3 parallel, then 1", () => {
    assert.deepEqual(v.batches, [["diff", "guardrail", "roast"], ["bugsum"]]);
  });
});

describe("state machine — PARTIAL (the differentiator)", () => {
  const v = applyAll(mockRunSync("partial"));

  test("ends PARTIAL with a refund recorded", () => {
    assert.equal(v.status, "PARTIAL");
    assert.equal(v.refundedUSDC, "0.03");
  });

  test("the failed provider is refunded, with a linkable txid", () => {
    const r = refundedNodes(v);
    assert.equal(r.length, 1);
    assert.equal(r[0]!.state, "refunded");
    assert.match(r[0]!.compensationExplorerUrl!, /^https:\/\//);
  });

  test("the other three still delivered", () => {
    const delivered = Object.values(v.nodes).filter((n) => n.state === "delivered");
    assert.equal(delivered.length, 3);
  });

  test("headline names the refund", () => {
    assert.match(outcomeHeadline(v), /Partial.*refunded/);
  });
});

describe("state machine — blocked paths cost nothing", () => {
  test("policy rejection never composes or signs", () => {
    const v = applyAll(mockRunSync("policyBlocked"));
    assert.equal(v.status, "FAILED");
    assert.equal(v.policy.verdict, "FAIL");
    assert.equal(v.group.slots.length, 0, "nothing composed");
    assert.equal(v.group.signatureCount, undefined, "nothing signed");
    assert.equal(v.error?.costedNothing, true);
    assert.match(outcomeHeadline(v), /paid nothing/);
  });

  test("simulation failure composes but NEVER settles", () => {
    const v = applyAll(mockRunSync("simulationFailed"));
    assert.ok(v.group.slots.length > 0, "composed");
    assert.equal(v.group.simulated, false);
    assert.equal(v.group.groupId, undefined, "never settled");
    assert.equal(settledTxids(v).length, 0);
    assert.equal(v.error?.costedNothing, true);
  });
});

describe("state machine — robustness", () => {
  test("is pure — applying an event does not mutate the input", () => {
    const a = initialRunView();
    const snapshot = JSON.stringify(a);
    applyEvent(a, mockRunSync("happy")[0]!);
    assert.equal(JSON.stringify(a), snapshot);
  });

  test("detects a dropped event (SSE has no replay)", () => {
    const events = mockRunSync("happy");
    const withGap = [events[0]!, ...events.slice(3)];
    assert.equal(applyAll(withGap).hasGap, true);
  });

  test("a clean stream reports no gap", () => {
    assert.equal(applyAll(mockRunSync("happy")).hasGap, false);
  });

  test("ignores unknown event types instead of crashing", () => {
    const v = applyEvent(initialRunView(), { type: "future.event", seq: 0, at: new Date().toISOString(), runId: "r" } as never);
    assert.equal(v.status, "idle");
    assert.equal(v.log.length, 1);
  });

  test("every scenario reaches a terminal state", () => {
    for (const s of ["happy", "partial", "policyBlocked", "simulationFailed"] as const) {
      assert.ok(isTerminal(applyAll(mockRunSync(s))), `${s} must terminate`);
    }
  });
});


test("payment uncertainty is terminal recovery, never a zero-cost failure", () => {
  const view = applyEvent(initialRunView(), {
    type: "run.error", runId: "run-recovery", seq: 0, at: new Date().toISOString(),
    code: "PAYMENT_RECOVERY_REQUIRED", message: "confirmation unavailable", costedNothing: false,
  });
  assert.equal(view.status, "RECOVERY_REQUIRED");
  assert.equal(isTerminal(view), true);
  assert.equal(view.error?.costedNothing, false);
  assert.match(outcomeHeadline(view), /reconciliation/);
  assert.doesNotMatch(outcomeHeadline(view), /paid nothing/);
});
