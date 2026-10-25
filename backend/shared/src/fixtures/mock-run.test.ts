import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mockRunSync } from "./mock-run.ts";
import { zRunEvent } from "../schemas/events.ts";

const SCENARIOS = ["happy", "partial", "policyBlocked", "simulationFailed"] as const;

describe("mock run fixture", () => {
  for (const s of SCENARIOS) {
    test(`${s}: every event validates against the real RunEvent schema`, () => {
      const events = mockRunSync(s);
      assert.ok(events.length > 0);
      for (const e of events) {
        const r = zRunEvent.safeParse(e);
        assert.ok(r.success, `invalid ${e.type}: ${JSON.stringify(r.error?.issues?.[0])}`);
      }
    });

    test(`${s}: seq is strictly increasing and gapless`, () => {
      const seqs = mockRunSync(s).map((e) => e.seq);
      assert.deepEqual(seqs, seqs.map((_, i) => i));
    });

    test(`${s}: terminates in exactly one run.completed`, () => {
      const events = mockRunSync(s);
      assert.equal(events.filter((e) => e.type === "run.completed").length, 1);
      assert.equal(events.at(-1)!.type, "run.completed");
    });
  }

  test("partial: exercises the refund path end to end", () => {
    const e = mockRunSync("partial");
    const comp = e.find((x) => x.type === "compensation.issued");
    assert.ok(comp, "the whole point of this scenario");
    const done = e.find((x) => x.type === "run.completed")!;
    assert.equal(done.status, "PARTIAL");
    assert.equal(done.refundedUSDC, "0.03");
    // money must visibly go backwards
    const states = e.filter((x) => x.type === "node.state").map((x) => x.state);
    assert.ok(states.includes("compensating"));
    assert.ok(states.includes("refunded"));
  });

  test("policyBlocked: nothing is signed and it cost nothing", () => {
    const e = mockRunSync("policyBlocked");
    assert.equal(e.some((x) => x.type === "group.composed"), false);
    assert.equal(e.some((x) => x.type === "group.signed"), false);
    const err = e.find((x) => x.type === "run.error")!;
    assert.equal(err.costedNothing, true);
  });

  test("simulationFailed: composed but NEVER submitted", () => {
    const e = mockRunSync("simulationFailed");
    assert.ok(e.some((x) => x.type === "group.composed"));
    assert.equal(e.some((x) => x.type === "group.settled"), false);
    assert.equal(e.find((x) => x.type === "run.error")!.costedNothing, true);
  });

  test("happy: settles with four txids and exactly one signature", () => {
    const e = mockRunSync("happy");
    const settled = e.find((x) => x.type === "group.settled")!;
    assert.equal(settled.txids.length, 4);
    assert.equal(new Set(settled.txids.map((t) => t.payTo)).size, 4, "4 DISTINCT payees");
    assert.equal(e.find((x) => x.type === "group.signed")!.signatureCount, 1);
  });
});
