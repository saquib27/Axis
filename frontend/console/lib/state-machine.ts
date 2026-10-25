/**
 * The event → view state machine. Phase F1.1.
 *
 * This is the single most important file in the frontend. It is a PURE
 * function — no React, no fetch, no timers — so it can be unit tested against
 * the mock stream and cannot desync from the protocol.
 *
 *     (state, RunEvent) -> state
 *
 * Everything on screen derives from `RunView`. Components receive slices of it
 * as props and render; they never compute anything themselves. That separation
 * is what lets Phase F2 (UI) build in parallel with Phase F1 (UX).
 *
 * Two rules that keep it honest:
 *
 *  1. Money is never computed here. Amounts arrive as decimal strings from the
 *     router and are passed through untouched. The backend owns arithmetic;
 *     the console owns presentation. A float in a payment UI is still a bug.
 *  2. `costedNothing` is taken from the event, never inferred. Whether the
 *     agent was charged is a fact the backend asserts — guessing it in the UI
 *     is how you end up telling someone they paid when they didn't.
 */
import type { RunEvent, NodeState, ProtocolStep } from "@axis/shared";

export interface NodeView {
  stepId: string;
  provider: string;
  state: NodeState;
  priceUSDC?: string;
  payTo?: string;
  /** The verbatim 402 body — shown raw, because a judge should see real protocol. */
  challenge?: Record<string, unknown>;
  txid?: string;
  explorerUrl?: string;
  latencyMs?: number;
  preview?: string;
  error?: string;
  compensationTxid?: string;
  compensationExplorerUrl?: string;
}

export interface StepProgress {
  step: ProtocolStep;
  status: "pending" | "active" | "done" | "failed";
  detail?: string;
}

export interface PolicyCheckView {
  rule: string;
  passed: boolean;
  limitUSDC?: string;
  actualUSDC?: string;
  headroomUSDC?: string;
}

export interface GroupSlotView {
  index: number;
  kind: "feePayer" | "payment";
  stepId?: string;
  payTo?: string;
  amountUSDC?: string;
}

export interface RunView {
  runId: string | null;
  workflow: string | null;
  agentAddress: string | null;
  network: string | null;

  /** Parallel batches: batches[0] animates together, then batches[1]. */
  batches: string[][];
  edges: { from: string; to: string }[];
  nodes: Record<string, NodeView>;

  /** The brief's own 8 steps, for the progress rail. */
  protocol: StepProgress[];

  quote: {
    quoteId?: string;
    subtotalUSDC?: string;
    routingFeeUSDC?: string;
    totalUSDC?: string;
    expiresAt?: string;
  };

  policy: {
    verdict?: "PASS" | "FAIL";
    checks: PolicyCheckView[];
    violations: string[];
  };

  group: {
    slots: GroupSlotView[];
    groupSize?: number;
    maxGroupSize?: number;
    groupId?: string;
    confirmedRound?: number;
    simulated?: boolean;
    simulationFailure?: string;
    failedSlotIndex?: number;
    /** Always 1 when signed. The whole thesis, as a number on screen. */
    signatureCount?: number;
  };

  status: "idle" | "running" | "RECOVERY_REQUIRED" | "SETTLED" | "PARTIAL" | "REVERSED" | "FAILED";
  receiptId?: string;
  totalUSDC?: string;
  refundedUSDC?: string;
  durationMs?: number;

  error?: { code: string; message: string; costedNothing: boolean };

  /** Raw feed, newest last. Rendered verbatim in the event log. */
  log: RunEvent[];
  lastSeq: number;
  /** True if a seq was skipped — the UI should show a reconnect hint. */
  hasGap: boolean;
}

const STEPS: ProtocolStep[] = [
  "discover", "challenge", "quote", "policy",
  "compose", "simulate", "sign", "settle",
];

export function initialRunView(): RunView {
  return {
    runId: null, workflow: null, agentAddress: null, network: null,
    batches: [], edges: [], nodes: {},
    protocol: STEPS.map((step) => ({ step, status: "pending" as const })),
    quote: {},
    policy: { checks: [], violations: [] },
    group: { slots: [] },
    status: "idle",
    log: [], lastSeq: -1, hasGap: false,
  };
}

/** Mark a protocol step, and implicitly complete every step before it. */
function markStep(
  protocol: StepProgress[],
  step: ProtocolStep,
  status: StepProgress["status"],
  detail?: string,
): StepProgress[] {
  const idx = STEPS.indexOf(step);
  return protocol.map((p, i) => {
    // Backfill ANY unfinished earlier step, not just pending ones. A step left
    // on "active" (e.g. `discover`, which has no explicit completion event)
    // would otherwise sit spinning in the rail for the whole run.
    if (i < idx && p.status !== "done" && p.status !== "failed") {
      return { ...p, status: "done" as const };
    }
    if (i === idx) return { ...p, status, ...(detail ? { detail } : {}) };
    return p;
  });
}

function patchNode(s: RunView, stepId: string, patch: Partial<NodeView>): RunView {
  const existing = s.nodes[stepId];
  if (!existing) return s;
  return { ...s, nodes: { ...s.nodes, [stepId]: { ...existing, ...patch } } };
}

/**
 * Apply one event. Never mutates — returns a new view.
 *
 * Unknown event types are appended to the log and otherwise ignored, so a
 * backend that adds an event type cannot break a deployed console.
 */
export function applyEvent(prev: RunView, e: RunEvent): RunView {
  // Gap detection. SSE has no replay, so a skipped seq means we missed
  // something and the UI should say so rather than silently render a lie.
  const hasGap = prev.hasGap || (prev.lastSeq >= 0 && e.seq > prev.lastSeq + 1);
  let s: RunView = {
    ...prev,
    log: [...prev.log, e],
    lastSeq: Math.max(prev.lastSeq, e.seq),
    hasGap,
  };

  switch (e.type) {
    case "run.started":
      return {
        ...s,
        runId: e.runId,
        workflow: e.workflow,
        agentAddress: e.agentAddress,
        network: e.network,
        batches: e.batches,
        edges: e.edges,
        status: "running",
        nodes: Object.fromEntries(
          e.nodes.map((n) => [
            n.stepId,
            { stepId: n.stepId, provider: n.provider, state: "idle" as NodeState },
          ]),
        ),
      };

    case "probe.sent":
      return { ...s, protocol: markStep(s.protocol, "discover", "active") };

    case "challenge.received":
      s = patchNode(s, e.stepId, {
        priceUSDC: e.priceUSDC,
        payTo: e.payTo,
        challenge: e.raw,
        latencyMs: e.latencyMs,
      });
      return { ...s, protocol: markStep(s.protocol, "challenge", "active") };

    case "quote.ready":
      return {
        ...s,
        quote: {
          quoteId: e.quoteId,
          subtotalUSDC: e.subtotalUSDC,
          routingFeeUSDC: e.routingFeeUSDC,
          totalUSDC: e.totalUSDC,
          expiresAt: e.expiresAt,
        },
        protocol: markStep(s.protocol, "quote", "done", `${e.totalUSDC} USDC`),
      };

    case "policy.evaluated":
      return {
        ...s,
        policy: { verdict: e.verdict, checks: e.checks, violations: e.violations },
        protocol: markStep(
          s.protocol, "policy",
          e.verdict === "PASS" ? "done" : "failed",
          e.verdict === "FAIL" ? e.violations[0] : undefined,
        ),
      };

    case "group.composed":
      return {
        ...s,
        group: { ...s.group, slots: e.slots, groupSize: e.groupSize, maxGroupSize: e.maxGroupSize },
        protocol: markStep(s.protocol, "compose", "done", `${e.groupSize} txns`),
      };

    case "group.simulated":
      return {
        ...s,
        group: {
          ...s.group,
          simulated: e.passed,
          simulationFailure: e.failureMessage,
          failedSlotIndex: e.failedSlotIndex,
        },
        protocol: markStep(
          s.protocol, "simulate",
          e.passed ? "done" : "failed",
          e.passed ? `${e.durationMs}ms` : e.failureMessage,
        ),
      };

    case "settle.retry":
      return {
        ...s,
        protocol: markStep(s.protocol, "settle", "active", `retry ${e.attempt}/${e.maxAttempts - 1} — ${e.message}`),
      };

    case "group.signed":
      return {
        ...s,
        group: { ...s.group, signatureCount: e.signatureCount },
        protocol: markStep(
          s.protocol, "sign", "done",
          `${e.signatureCount} signature · ${e.legCount} payments`,
        ),
      };

    case "group.settled":
      for (const t of e.txids) {
        s = patchNode(s, t.stepId, { txid: t.txid, explorerUrl: t.explorerUrl });
      }
      return {
        ...s,
        group: { ...s.group, groupId: e.groupId, confirmedRound: e.confirmedRound },
        protocol: markStep(s.protocol, "settle", "done", `round ${e.confirmedRound}`),
      };

    case "step.delivered":
      return patchNode(s, e.stepId, { latencyMs: e.latencyMs, preview: e.preview });

    case "step.failed":
      return patchNode(s, e.stepId, { error: e.message });

    case "step.skipped":
      return patchNode(s, e.stepId, { error: `skipped — ${e.becauseStepId} failed` });

    case "compensation.issued":
      // Money going backwards. The single best moment in the demo.
      return patchNode(s, e.stepId, {
        compensationTxid: e.txid,
        compensationExplorerUrl: e.explorerUrl,
      });

    case "node.state":
      return patchNode(s, e.stepId, { state: e.state });

    case "run.completed":
      return {
        ...s,
        status: e.status,
        receiptId: e.receiptId,
        totalUSDC: e.totalUSDC,
        refundedUSDC: e.refundedUSDC,
        durationMs: e.durationMs,
      };

    case "run.error":
      // costedNothing comes straight from the backend — never inferred here.
      return {
        ...s,
        status: e.code === "PAYMENT_RECOVERY_REQUIRED" ? "RECOVERY_REQUIRED" : "FAILED",
        error: { code: e.code, message: e.message, costedNothing: e.costedNothing },
      };

    default:
      return s;
  }
}

/** Fold a whole stream. Handy for tests and for rendering a finished run. */
export const applyAll = (events: readonly RunEvent[], from = initialRunView()): RunView =>
  events.reduce(applyEvent, from);

// ── Derived selectors. Components call these; they never derive anything. ──

export const nodesInBatch = (v: RunView, i: number): NodeView[] =>
  (v.batches[i] ?? []).map((id) => v.nodes[id]).filter(Boolean) as NodeView[];

export const settledTxids = (v: RunView): NodeView[] =>
  Object.values(v.nodes).filter((n) => n.txid);

export const refundedNodes = (v: RunView): NodeView[] =>
  Object.values(v.nodes).filter((n) => n.compensationTxid);

export const isTerminal = (v: RunView): boolean =>
  ["SETTLED", "PARTIAL", "REVERSED", "FAILED", "RECOVERY_REQUIRED"].includes(v.status);

/**
 * The headline the UI should show when a run ends. Failing at zero cost is a
 * FEATURE of AXIS, so it gets stated plainly rather than shown as a red error.
 */
export function outcomeHeadline(v: RunView): string {
  if (v.status === "RECOVERY_REQUIRED") return "Payment status needs reconciliation — do not submit again";
  if (v.status === "SETTLED") return `Settled — ${v.totalUSDC} USDC across ${settledTxids(v).length} providers`;
  if (v.status === "PARTIAL") return `Partial — ${v.refundedUSDC} USDC refunded on chain`;
  if (v.status === "REVERSED") return `Reversed — everything refunded`;
  if (v.status === "FAILED") {
    return v.error?.costedNothing
      ? `Rejected before signing — you paid nothing`
      : `Failed — ${v.error?.message ?? "unknown error"}`;
  }
  return v.status === "running" ? "Running…" : "Ready";
}
