/**
 * A quote is a signed price promise with an expiry.
 *
 * Signed so it cannot be altered between quote and execute; expiring because a
 * price read from a provider's 402 goes stale; single-use so it cannot be
 * replayed into a second settlement.
 */
import { z } from "zod";
import { zAlgorandAddress } from "./workflow.ts";
import { zPolicyVerdict } from "./policy.ts";

export const zQuoteLeg = z.object({
  stepId: z.string(),
  provider: z.string(),
  payTo: zAlgorandAddress,
  priceUSDC: z.string(),
  asset: z.string(),
  /** The provider's verbatim 402 body — shown raw in the console. */
  challenge: z.record(z.unknown()),
});

export const zQuote = z.object({
  quoteId: z.string(),
  workflow: z.string(),
  agentAddress: zAlgorandAddress,
  network: z.string(),
  dag: z.object({
    batches: z.array(z.array(z.string())),
    edges: z.array(z.object({ from: z.string(), to: z.string() })),
  }),
  legs: z.array(zQuoteLeg),
  subtotalUSDC: z.string(),
  routingFeeUSDC: z.string(),
  totalUSDC: z.string(),
  policy: zPolicyVerdict,
  expiresAt: z.string().datetime(),
  /** Router signature over the canonical serialization of everything above. */
  signature: z.string(),
});

export const zQuoteStatus = z.enum(["OPEN", "CONSUMED", "EXPIRED", "REJECTED"]);

export const zExecuteRequest = z.object({
  quoteId: z.string(),
  /** Base64 msgpack — the agent's signed atomic group. */
  signedGroup: z.string(),
});

export type Quote = z.infer<typeof zQuote>;
export type QuoteLeg = z.infer<typeof zQuoteLeg>;
export type ExecuteRequest = z.infer<typeof zExecuteRequest>;
