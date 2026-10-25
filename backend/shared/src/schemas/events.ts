/**
 * THE LIVE EVENT STREAM — the contract between the router and the console.
 *
 * This file is why the demo looks alive. The router emits one of these over SSE
 * at every meaningful moment, and the console animates whatever it receives.
 * Nothing is faked, nothing is replayed from a recording: if a provider is slow,
 * the node sits spinning; if a payment reverses, the money animates backwards.
 *
 * Design rules that make the animation possible:
 *
 *   1. Every event carries `seq` and `at`, so the console can order and time
 *      them even if SSE delivers out of order after a reconnect.
 *   2. Events name the x402 protocol step they belong to (`step: 1..8`). The
 *      console renders those eight steps as a progress rail — a judge can watch
 *      the brief's own checklist tick off in real time.
 *   3. Amounts are decimal strings, addresses/txids are full, and every event
 *      carries enough context to animate WITHOUT the console holding state it
 *      might have missed. A late-joining viewer can still render correctly.
 *   4. Anything with a txid also carries `explorerUrl`, so a judge is one click
 *      from the chain.
 */
import { z } from "zod";

/** The 8 canonical x402 protocol steps, as named by the track brief. */
export const PROTOCOL_STEPS = [
  "discover", // 1 unpaid probes go out
  "challenge", // 2 402s come back with prices
  "quote", // 3 DAG resolved, total computed
  "policy", // 4 spend guard verdict
  "compose", // 5 atomic group assembled
  "simulate", // 6 dry run
  "sign", // 7 the single agent signature
  "settle", // 8 submitted + confirmed on chain
] as const;
export const zProtocolStep = z.enum(PROTOCOL_STEPS);
export type ProtocolStep = z.infer<typeof zProtocolStep>;

/** Per-node visual state in the workflow graph. Drives node colour + motion. */
export const zNodeState = z.enum([
  "idle", // not started — dim
  "probing", // asking for a price — pulsing outline
  "quoted", // price known — solid outline, price badge
  "blocked", // policy rejected — red, everything stops
  "paying", // money in flight — coin animates along the edge
  "paid", // leg settled — edge turns solid, txid appears
  "running", // provider is doing the work — spinner
  "delivered", // result returned — node fills, result preview
  "failed", // provider errored after payment — node cracks
  "compensating", // refund in flight — coin animates BACKWARDS
  "refunded", // money returned — node greys, refund txid shown
  "skipped", // dependency failed — node fades out
]);
export type NodeState = z.infer<typeof zNodeState>;

const base = {
  /** Monotonic per-run. The console sorts on this; gaps mean a dropped event. */
  seq: z.number().int().nonnegative(),
  /** ISO timestamp — the console shows real elapsed time, not fake pacing. */
  at: z.string().datetime(),
  runId: z.string(),
};

const zLegRef = z.object({
  stepId: z.string(),
  provider: z.string(),
  payTo: z.string(),
  priceUSDC: z.string(),
});

export const zRunEvent = z.discriminatedUnion("type", [
  /** Run opened. Carries the whole graph up front so the console can draw it
   *  immediately — every node grey, edges dotted, nothing happening yet. */
  z.object({
    ...base,
    type: z.literal("run.started"),
    workflow: z.string(),
    agentAddress: z.string(),
    network: z.string(),
    /** Parallel batches. batches[0] animates simultaneously, then batches[1]. */
    batches: z.array(z.array(z.string())),
    edges: z.array(z.object({ from: z.string(), to: z.string() })),
    nodes: z.array(z.object({ stepId: z.string(), provider: z.string() })),
  }),

  /** ── Step 1–2: discovery ────────────────────────────────────────────── */
  z.object({
    ...base,
    type: z.literal("probe.sent"),
    step: z.literal("discover"),
    stepId: z.string(),
    provider: z.string(),
  }),
  /** A 402 came back. THIS is the moment a judge sees x402 actually happening —
   *  the console flashes the raw challenge JSON next to the node. */
  z.object({
    ...base,
    type: z.literal("challenge.received"),
    step: z.literal("challenge"),
    stepId: z.string(),
    provider: z.string(),
    priceUSDC: z.string(),
    payTo: z.string(),
    asset: z.string(),
    /** The literal 402 body, shown verbatim. No paraphrasing. */
    raw: z.record(z.unknown()),
    latencyMs: z.number().int(),
  }),

  /** ── Step 3: quote ──────────────────────────────────────────────────── */
  z.object({
    ...base,
    type: z.literal("quote.ready"),
    step: z.literal("quote"),
    quoteId: z.string(),
    legs: z.array(zLegRef),
    subtotalUSDC: z.string(),
    routingFeeUSDC: z.string(),
    totalUSDC: z.string(),
    expiresAt: z.string().datetime(),
  }),

  /** ── Step 4: the spend guard ────────────────────────────────────────── */
  z.object({
    ...base,
    type: z.literal("policy.evaluated"),
    step: z.literal("policy"),
    verdict: z.enum(["PASS", "FAIL"]),
    /** Every rule, pass or fail, WITH headroom — the console renders these as
     *  live budget bars. Showing the guard passing is as valuable as blocking. */
    checks: z.array(
      z.object({
        rule: z.string(),
        passed: z.boolean(),
        limitUSDC: z.string().optional(),
        actualUSDC: z.string().optional(),
        headroomUSDC: z.string().optional(),
      }),
    ),
    violations: z.array(z.string()),
  }),

  /** ── Step 5–6: compose + simulate ───────────────────────────────────── */
  z.object({
    ...base,
    type: z.literal("group.composed"),
    step: z.literal("compose"),
    /** The console draws these as physical slots snapping into one container. */
    slots: z.array(
      z.object({
        index: z.number().int(),
        kind: z.enum(["feePayer", "payment"]),
        stepId: z.string().optional(),
        payTo: z.string().optional(),
        amountUSDC: z.string().optional(),
      }),
    ),
    groupSize: z.number().int(),
    maxGroupSize: z.number().int(),
  }),
  /** The free dry run. On failure NOTHING is submitted — the console should make
   *  that unmissable, because "we caught it and it cost nothing" is the point. */
  z.object({
    ...base,
    type: z.literal("group.simulated"),
    step: z.literal("simulate"),
    passed: z.boolean(),
    durationMs: z.number().int(),
    failureMessage: z.string().optional(),
    failedSlotIndex: z.number().int().optional(),
  }),

  /** ── Step 7: the single signature ───────────────────────────────────── */
  z.object({
    ...base,
    type: z.literal("group.signed"),
    step: z.literal("sign"),
    /** Always 1. The console shows "1 signature for N payments" as a counter. */
    signatureCount: z.literal(1),
    legCount: z.number().int(),
  }),

  /** Settlement failed to submit and is being retried automatically. The agent
   *  retries a failed payment up to a fixed number of times, then stops. */
  z.object({
    ...base,
    type: z.literal("settle.retry"),
    step: z.literal("settle"),
    attempt: z.number().int(),
    maxAttempts: z.number().int(),
    message: z.string(),
  }),

  /** ── Step 8: settlement ─────────────────────────────────────────────── */
  z.object({
    ...base,
    type: z.literal("group.settled"),
    step: z.literal("settle"),
    groupId: z.string(),
    confirmedRound: z.number().int(),
    durationMs: z.number().int(),
    /** One txid per leg, each with a live explorer link. */
    txids: z.array(
      z.object({
        stepId: z.string(),
        txid: z.string(),
        explorerUrl: z.string().url(),
        amountUSDC: z.string(),
        payTo: z.string(),
      }),
    ),
  }),

  /** ── Execution ──────────────────────────────────────────────────────── */
  z.object({ ...base, type: z.literal("step.started"), stepId: z.string() }),
  z.object({
    ...base,
    type: z.literal("step.delivered"),
    stepId: z.string(),
    latencyMs: z.number().int(),
    /** Short preview so the node can show real output, not a checkmark. */
    preview: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("step.failed"),
    stepId: z.string(),
    code: z.string(),
    message: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal("step.skipped"),
    stepId: z.string(),
    becauseStepId: z.string(),
  }),

  /** ── The differentiator: money going BACKWARDS ──────────────────────── */
  z.object({
    ...base,
    type: z.literal("compensation.issued"),
    stepId: z.string(),
    provider: z.string(),
    amountUSDC: z.string(),
    txid: z.string(),
    explorerUrl: z.string().url(),
    reason: z.string(),
  }),

  /** Any node's visual state changed. Emitted alongside the semantic events
   *  above so the console never has to infer state — it just applies it. */
  z.object({
    ...base,
    type: z.literal("node.state"),
    stepId: z.string(),
    state: zNodeState,
  }),

  z.object({
    ...base,
    type: z.literal("run.completed"),
    status: z.enum(["SETTLED", "PARTIAL", "REVERSED", "FAILED"]),
    receiptId: z.string(),
    totalUSDC: z.string(),
    refundedUSDC: z.string(),
    durationMs: z.number().int(),
  }),

  z.object({
    ...base,
    type: z.literal("run.error"),
    code: z.string(),
    message: z.string(),
    /** True when the failure cost the agent nothing — the console says so
     *  loudly, because "it failed and you paid zero" is a feature. */
    costedNothing: z.boolean(),
  }),
]);

export type RunEvent = z.infer<typeof zRunEvent>;
export type RunEventType = RunEvent["type"];
