import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluate, DEFAULT_POLICY, type QuoteForPolicy, type SpendHistory } from "./evaluate.ts";

const noHistory: SpendHistory = { spentLastHourMicro: 0n, callsLastHour: 0 };

// The pr-review quote: 4 legs, $0.14 total, all trusted.
const okQuote: QuoteForPolicy = {
  grandTotalMicro: 140_000n,
  legs: [
    { provider: "diff-explainer", priceMicro: 30_000n, trustScore: 90 },
    { provider: "guardrail-checker", priceMicro: 20_000n, trustScore: 95 },
    { provider: "commit-roaster", priceMicro: 30_000n, trustScore: 85 },
    { provider: "bug-summarizer", priceMicro: 50_000n, trustScore: 88 },
  ],
};

describe("guard — PASS path", () => {
  test("a normal workflow passes with headroom on every rule", () => {
    const v = evaluate(okQuote, DEFAULT_POLICY, noHistory);
    assert.equal(v.verdict, "PASS");
    assert.equal(v.checks.length, 6);
    assert.equal(v.violations.length, 0);
    // headroom is reported even when passing (drives the console bars)
    const wf = v.checks.find((c) => c.rule === "maxWorkflowSpend")!;
    assert.equal(wf.headroomUSDC, "0.86"); // 1.00 - 0.14
  });
});

describe("guard — each rule blocks", () => {
  test("kill switch blocks everything", () => {
    const v = evaluate(okQuote, { ...DEFAULT_POLICY, killSwitch: true }, noHistory);
    assert.equal(v.verdict, "FAIL");
    assert.equal(v.checks.find((c) => c.rule === "killSwitch")!.passed, false);
  });

  test("per-workflow ceiling blocks an over-budget quote", () => {
    const v = evaluate(okQuote, { ...DEFAULT_POLICY, maxWorkflowMicro: 100_000n }, noHistory);
    assert.equal(v.verdict, "FAIL");
    assert.match(v.violations[0]!, /maxWorkflowSpend/);
  });

  test("per-provider cap blocks a single expensive leg", () => {
    const v = evaluate(okQuote, { ...DEFAULT_POLICY, maxProviderMicro: 40_000n }, noHistory);
    assert.equal(v.verdict, "FAIL"); // bugsum is 0.05 > 0.04
    assert.equal(v.checks.find((c) => c.rule === "maxProviderSpend")!.passed, false);
  });

  test("hourly SPEND velocity blocks after enough prior spend", () => {
    const v = evaluate(okQuote, DEFAULT_POLICY, { spentLastHourMicro: 9_900_000n, callsLastHour: 0 });
    assert.equal(v.verdict, "FAIL"); // 9.90 + 0.14 > 10.00
    assert.equal(v.checks.find((c) => c.rule === "hourlySpendLimit")!.passed, false);
  });

  test("hourly CALL velocity blocks after enough prior calls", () => {
    const v = evaluate(okQuote, DEFAULT_POLICY, { spentLastHourMicro: 0n, callsLastHour: 98 });
    assert.equal(v.verdict, "FAIL"); // 98 + 4 > 100
    assert.equal(v.checks.find((c) => c.rule === "hourlyCallLimit")!.passed, false);
  });

  test("provider trust blocks a distrusted provider", () => {
    const q = { ...okQuote, legs: [{ provider: "sketchy", priceMicro: 30_000n, trustScore: 20 }, ...okQuote.legs.slice(1)] };
    const v = evaluate(q, DEFAULT_POLICY, noHistory);
    assert.equal(v.verdict, "FAIL");
    assert.match(v.checks.find((c) => c.rule === "providerTrust")!.detail!, /sketchy/);
  });
});

describe("guard — client constraint only tightens", () => {
  test("a tighter client max is enforced", () => {
    const q = { ...okQuote, clientMaxMicro: 100_000n }; // client says max $0.10
    const v = evaluate(q, DEFAULT_POLICY, noHistory);
    assert.equal(v.verdict, "FAIL"); // 0.14 > client's 0.10
  });

  test("a LOOSER client max cannot raise the policy ceiling", () => {
    const q = { ...okQuote, grandTotalMicro: 2_000_000n, clientMaxMicro: 5_000_000n }; // client tries $5 but policy is $1
    const v = evaluate(q, DEFAULT_POLICY, noHistory);
    assert.equal(v.verdict, "FAIL"); // still blocked by the $1 policy ceiling
    assert.equal(v.checks.find((c) => c.rule === "maxWorkflowSpend")!.limitUSDC, "1");
  });
});
