/**
 * The unified receipt — the artifact that proves the whole thesis.
 *
 * Ask any per-call x402 system "what did this one report cost me" and it cannot
 * answer. This can: one group id, N txids, N results, one total, one status.
 */
import { z } from "zod";
import { zAlgorandAddress } from "./workflow.ts";

export const zRunStatus = z.enum([
  "PENDING",
  "RECOVERY_REQUIRED", // submission may have settled; never report zero cost
  "SETTLED",   // every provider paid AND delivered
  "PARTIAL",   // paid, but delivery is incomplete; refunds may be partial or absent
  "REVERSED",  // everything refunded
  "FAILED",    // never settled — cost zero
]);

export const zLegStatus = z.enum([
  "SUBMITTING",
  "PAID",
  "DELIVERED",
  "FAILED",
  "COMPENSATED", // took payment, failed to deliver, money returned on chain
  "SKIPPED",     // a dependency failed, so this never ran
]);

export const zReceiptLeg = z.object({
  stepId: z.string(),
  provider: z.string(),
  payTo: zAlgorandAddress,
  priceUSDC: z.string(),
  txid: z.string(),
  explorerUrl: z.string().url(),
  status: zLegStatus,
  latencyMs: z.number().int().optional(),
  attempts: z.number().int().default(1),
  compensationTxid: z.string().optional(),
  compensationExplorerUrl: z.string().url().optional(),
  error: z.string().optional(),
});

export const zReceipt = z.object({
  receiptId: z.string(),
  workflow: z.string(),
  status: zRunStatus,
  network: z.string(),
  groupId: z.string(),
  confirmedRound: z.number().int().optional(),
  agentAddress: zAlgorandAddress,
  /** Always 1. The entire point of AXIS, stated as data. */
  signatureCount: z.literal(1),
  legs: z.array(zReceiptLeg),
  routingFeeUSDC: z.string(),
  totalUSDC: z.string(),
  refundedUSDC: z.string(),
  durationMs: z.number().int().optional(),
  createdAt: z.string().datetime(),
});

export type Receipt = z.infer<typeof zReceipt>;
export type ReceiptLeg = z.infer<typeof zReceiptLeg>;
export type RunStatus = z.infer<typeof zRunStatus>;
