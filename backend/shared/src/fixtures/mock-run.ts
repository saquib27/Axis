/**
 * A complete, realistic run — as `RunEvent`s, with real timings.
 *
 * This exists so the frontend can be built and animated TODAY, before the router
 * exists. It emits the exact same types the real router will emit, so switching
 * to live is a one-line import change, not a rewrite.
 *
 * The default scenario deliberately includes a provider that takes payment and
 * then FAILS, so the refund path — the hardest thing to build and the best thing
 * to demo — is exercised from day one rather than bolted on at the end.
 *
 *   for await (const e of mockRun()) applyEvent(e)           // realistic timing
 *   for (const e of mockRunSync()) applyEvent(e)             // instant, for tests
 *   mockRun({ scenario: "policyBlocked" })                   // other paths
 */
import type { RunEvent } from "../schemas/events.ts";

export type MockScenario =
  | "happy" // everything pays and delivers
  | "partial" // one provider is paid, fails, and is refunded  ← default
  | "policyBlocked" // spend ceiling rejects it before any signature
  | "simulationFailed"; // caught in the dry run; nothing submitted

const RUN = "run_mock01";
const explorer = (t: string) => `https://lora.algokit.io/testnet/transaction/${t}`;

const LEGS = [
  { stepId: "diff", provider: "diff-explainer", payTo: "3HDFJL3SN4LVLPBSEYOEB5IG3RMFRBOPX65W4P6WTE3ABE73RR6H2C34YI", priceUSDC: "0.03", txid: "TYQU2WJAOQF4YMQCFXW4YQB7CK6UO3U7INDYM7HF2XNKIDUIXZMQ" },
  { stepId: "guardrail", provider: "guardrail-checker", payTo: "IO3MELICZXJ54AD4Y5IOSSQSCF4WXEC3IAMG6T4RD2VOWN53G5ZDWHCDEU", priceUSDC: "0.02", txid: "4MENX2HENBVMINLJZH3NG72RE54A3ERX666NEUUAWM2FTI2UCJBQ" },
  { stepId: "roast", provider: "commit-roaster", payTo: "FKBLIFVXJU7VDR7QBT6UA3NQVOSJAA3XX2F5MYSISP57PKMF4GX4MWWJHA", priceUSDC: "0.03", txid: "XDKSRMH5WVDDO7GXB7EYDOKTCM2SJ3XBUZBYOVPNMHMJNZGBK37Q" },
  { stepId: "bugsum", provider: "bug-summarizer", payTo: "UX47LWFY55BHF4XBW7PNSPVDAZKWPTR3T6QJ67KD7DSDTENTSI7KZRLINY", priceUSDC: "0.05", txid: "DZOEFOGN7PFMEPS7BXXMJAGM2G7KQVLB5MSSZTSJ3PAKG7E6RKBA" },
] as const;

/** A leg's 402 body, shown verbatim in the console. */
const challenge = (l: (typeof LEGS)[number]) => ({
  x402Version: 1,
  accepts: [
    {
      scheme: "exact",
      network: "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe",
      maxAmountRequired: String(Math.round(Number(l.priceUSDC) * 1e6)),
      asset: "10458941",
      payTo: l.payTo,
      resource: `https://${l.provider}.axis.workers.dev/`,
      maxTimeoutSeconds: 60,
    },
  ],
});

/** Events paired with the delay BEFORE each, so playback feels like the real thing. */
type Timed = { after: number; event: RunEvent };

function script(scenario: MockScenario): Timed[] {
  let seq = 0;
  const t0 = Date.parse("2026-08-08T00:00:00.000Z");
  let clock = 0;
  const out: Timed[] = [];

  const push = (after: number, e: Omit<RunEvent, "seq" | "at" | "runId">) => {
    clock += after;
    out.push({
      after,
      event: {
        ...e,
        seq: seq++,
        at: new Date(t0 + clock).toISOString(),
        runId: RUN,
      } as RunEvent,
    });
  };

  const state = (after: number, stepId: string, s: string) =>
    push(after, { type: "node.state", stepId, state: s } as never);

  push(0, {
    type: "run.started",
    workflow: "pr-review",
    agentAddress: "NG5SZZ3U6XOB4L5N4CPZ7SLIZRDIEK2CM4XMB5WDPLAWSCIRCIJTTKYOPQ",
    network: "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe",
    batches: [["diff", "guardrail", "roast"], ["bugsum"]],
    edges: [{ from: "diff", to: "bugsum" }],
    nodes: LEGS.map((l) => ({ stepId: l.stepId, provider: l.provider })),
  } as never);

  // ── Steps 1–2: unpaid discovery, all four in parallel ──────────────────
  for (const l of LEGS) {
    push(40, { type: "probe.sent", step: "discover", stepId: l.stepId, provider: l.provider } as never);
    state(0, l.stepId, "probing");
  }
  const latencies = [180, 240, 150, 310];
  LEGS.forEach((l, i) => {
    push(latencies[i]!, {
      type: "challenge.received",
      step: "challenge",
      stepId: l.stepId,
      provider: l.provider,
      priceUSDC: l.priceUSDC,
      payTo: l.payTo,
      asset: "10458941",
      raw: challenge(l),
      latencyMs: latencies[i]!,
    } as never);
    state(0, l.stepId, "quoted");
  });

  // ── Step 3: quote ──────────────────────────────────────────────────────
  push(120, {
    type: "quote.ready",
    step: "quote",
    quoteId: "qt_mock01",
    legs: LEGS.map(({ stepId, provider, payTo, priceUSDC }) => ({ stepId, provider, payTo, priceUSDC })),
    subtotalUSDC: "0.13",
    routingFeeUSDC: "0.01",
    totalUSDC: "0.14",
    expiresAt: new Date(t0 + clock + 120_000).toISOString(),
  } as never);

  // ── Step 4: the spend guard ────────────────────────────────────────────
  const blocked = scenario === "policyBlocked";
  push(90, {
    type: "policy.evaluated",
    step: "policy",
    verdict: blocked ? "FAIL" : "PASS",
    checks: [
      { rule: "killSwitch", passed: true },
      { rule: "maxWorkflowSpend", passed: !blocked, limitUSDC: blocked ? "0.10" : "1.00", actualUSDC: "0.14", headroomUSDC: blocked ? "0" : "0.86" },
      { rule: "maxProviderSpend", passed: true, limitUSDC: "0.50", actualUSDC: "0.05", headroomUSDC: "0.45" },
      { rule: "hourlySpendLimit", passed: true, limitUSDC: "10.00", actualUSDC: "0.42", headroomUSDC: "9.58" },
      { rule: "hourlyCallLimit", passed: true, limitUSDC: "100", actualUSDC: "12" },
      { rule: "providerTrust", passed: true },
    ],
    violations: blocked ? ["maxWorkflowSpend: $0.14 exceeds the $0.10 per-workflow ceiling"] : [],
  } as never);

  if (blocked) {
    for (const l of LEGS) state(0, l.stepId, "blocked");
    push(30, {
      type: "run.error",
      code: "POLICY_VIOLATION",
      message: "Workflow total $0.14 exceeds per-workflow ceiling $0.10",
      costedNothing: true, // ← the UI should say this LOUDLY
    } as never);
    push(0, { type: "run.completed", status: "FAILED", receiptId: RUN, totalUSDC: "0", refundedUSDC: "0", durationMs: clock } as never);
    return out;
  }

  // ── Step 5: compose ────────────────────────────────────────────────────
  push(110, {
    type: "group.composed",
    step: "compose",
    slots: [
      { index: 0, kind: "feePayer" },
      ...LEGS.map((l, i) => ({ index: i + 1, kind: "payment" as const, stepId: l.stepId, payTo: l.payTo, amountUSDC: l.priceUSDC })),
    ],
    groupSize: 5,
    maxGroupSize: 16,
  } as never);

  // ── Step 6: simulate ───────────────────────────────────────────────────
  const simFailed = scenario === "simulationFailed";
  push(430, {
    type: "group.simulated",
    step: "simulate",
    passed: !simFailed,
    durationMs: 430,
    ...(simFailed
      ? { failureMessage: "underflow on subtracting 1000000000 from sender amount 19970000", failedSlotIndex: 2 }
      : {}),
  } as never);

  if (simFailed) {
    push(20, {
      type: "run.error",
      code: "SIMULATION_FAILED",
      message: "Group rejected in simulation — nothing was submitted",
      costedNothing: true,
    } as never);
    push(0, { type: "run.completed", status: "FAILED", receiptId: RUN, totalUSDC: "0", refundedUSDC: "0", durationMs: clock } as never);
    return out;
  }

  // ── Steps 7–8: one signature, then settlement ──────────────────────────
  push(260, { type: "group.signed", step: "sign", signatureCount: 1, legCount: 4 } as never);
  for (const l of LEGS) state(0, l.stepId, "paying");

  push(3100, {
    type: "group.settled",
    step: "settle",
    groupId: "iI8aYP4F2EyUE6DAmyLIwrWobfxsI5CAF10fpqoOo4Q=",
    confirmedRound: 66087237,
    durationMs: 3100,
    txids: LEGS.map((l) => ({ stepId: l.stepId, txid: l.txid, explorerUrl: explorer(l.txid), amountUSDC: l.priceUSDC, payTo: l.payTo })),
  } as never);
  for (const l of LEGS) state(0, l.stepId, "paid");

  // ── Execution: batch 0 runs in parallel, then batch 1 ──────────────────
  const failing = scenario === "partial" ? "roast" : null;

  for (const id of ["diff", "guardrail", "roast"]) {
    push(30, { type: "step.started", stepId: id } as never);
    state(0, id, "running");
  }
  push(1900, { type: "step.delivered", stepId: "diff", latencyMs: 1900, preview: "Adds retry-with-backoff to the payment client; widens the timeout from 10s to 60s." } as never);
  state(0, "diff", "delivered");
  push(400, { type: "step.delivered", stepId: "guardrail", latencyMs: 2300, preview: '{ "risk": 0.12, "flags": [] }' } as never);
  state(0, "guardrail", "delivered");

  if (failing) {
    push(900, { type: "step.failed", stepId: failing, code: "PROVIDER_FAILED", message: "provider returned 502 after payment settled" } as never);
    state(0, failing, "failed");
    // The differentiator: money goes BACKWARDS.
    state(180, failing, "compensating");
    push(1400, {
      type: "compensation.issued",
      stepId: failing,
      provider: "commit-roaster",
      amountUSDC: "0.03",
      txid: "CMPNSTQ7ZK4XW2M6RJ5YHF3TLPD8VN9BXQAE7CGKS2UWY4RM6HDA",
      explorerUrl: explorer("CMPNSTQ7ZK4XW2M6RJ5YHF3TLPD8VN9BXQAE7CGKS2UWY4RM6HDA"),
      reason: "paid but did not deliver",
    } as never);
    state(0, failing, "refunded");
  } else {
    push(1100, { type: "step.delivered", stepId: "roast", latencyMs: 3000, preview: '"fix stuff" → "fix(payments): widen client timeout to 60s"' } as never);
    state(0, "roast", "delivered");
  }

  // batch 1 — depends on diff's output
  push(120, { type: "step.started", stepId: "bugsum" } as never);
  state(0, "bugsum", "running");
  push(2400, { type: "step.delivered", stepId: "bugsum", latencyMs: 2400, preview: '{ "severity": "medium", "steps": ["POST /pay with a 12s upstream delay", "observe client abort"] }' } as never);
  state(0, "bugsum", "delivered");

  push(60, {
    type: "run.completed",
    status: failing ? "PARTIAL" : "SETTLED",
    receiptId: RUN,
    totalUSDC: failing ? "0.11" : "0.14",
    refundedUSDC: failing ? "0.03" : "0.00",
    durationMs: clock,
  } as never);

  return out;
}

export interface MockOptions {
  scenario?: MockScenario;
  /** 1 = real time, 0 = instant, 4 = four times faster. */
  speed?: number;
}

/** Async generator with realistic pacing — drive the UI with this. */
export async function* mockRun(opts: MockOptions = {}): AsyncGenerator<RunEvent> {
  const { scenario = "partial", speed = 1 } = opts;
  for (const { after, event } of script(scenario)) {
    if (speed > 0 && after > 0) {
      await new Promise((r) => setTimeout(r, after / speed));
    }
    yield event;
  }
}

/** Synchronous, instant — use this in state-machine unit tests. */
export function mockRunSync(scenario: MockScenario = "partial"): RunEvent[] {
  return script(scenario).map((t) => t.event);
}
