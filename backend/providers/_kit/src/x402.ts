/**
 * The x402 half of a provider: issue the 402 challenge, verify the payment.
 *
 * Two invariants, both load-bearing:
 *
 *  1. The PRICE lives here, in the challenge. The router never hardcodes it —
 *     it reads whatever the provider states. That is what makes the quote phase
 *     real price discovery rather than a lookup table.
 *
 *  2. Payment is verified BEFORE the model is called. Never burn tokens on an
 *     unpaid request. Verified by ordering in `paidHandler` below.
 */
import type { Context } from "hono";

export interface ProviderConfig {
  name: string;
  /** Decimal USDC, e.g. "0.03". Stated in the challenge; read by the router. */
  priceUSDC: string;
  description: string;
  payToEnvKey: string;
}

import type { LlmEnv } from "./llm.ts";

/** Every provider calls the model, so the LLM credentials are part of its env. */
export interface ProviderEnv extends LlmEnv {
  /** KV namespace backing single-use payment claims (mitigation M3). */
  AXIS_CLAIMS?: KVNamespace;
  /** Durable Object namespace for linearizable claims (blocks concurrent replay). */
  CLAIM_DO?: DurableObjectNamespace;
  FACILITATOR_URL?: string;
  NETWORK?: string;
  USDC_ASA_ID?: string;
  [k: string]: unknown;
}

const DEFAULT_NETWORK = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe";
const DEFAULT_ASA = "10458941";
const DEFAULT_FACILITATOR = "https://facilitator.goplausible.xyz";

const toAtomic = (usdc: string): string => {
  const [w = "0", f = ""] = usdc.split(".");
  return (BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0") || "0")).toString();
};

/** The 402 body. This is what the router parses during the quote phase. */
export function buildChallenge(cfg: ProviderConfig, env: ProviderEnv, resource: string) {
  const payTo = env[cfg.payToEnvKey];
  if (typeof payTo !== "string" || payTo.length !== 58) {
    throw new Error(`${cfg.payToEnvKey} missing or not a 58-char Algorand address`);
  }
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: env.NETWORK ?? DEFAULT_NETWORK,
        maxAmountRequired: toAtomic(cfg.priceUSDC),
        asset: env.USDC_ASA_ID ?? DEFAULT_ASA,
        payTo,
        resource,
        description: cfg.description,
        mimeType: "application/json",
        maxTimeoutSeconds: 60,
      },
    ],
  };
}

export interface VerifyResult {
  ok: boolean;
  txid?: string;
  error?: string;
}

/**
 * Verify an X-PAYMENT payload with the facilitator.
 *
 * The payload carries the WHOLE atomic group plus this provider's own
 * paymentIndex, so the facilitator checks only our leg while the group's
 * integrity covers the rest. See docs/PROTOCOL.md §3.
 */
export async function verifyPayment(
  header: string,
  cfg: ProviderConfig,
  env: ProviderEnv,
  resource: string,
): Promise<VerifyResult> {
  let payload: unknown;
  try {
    payload = JSON.parse(atob(header));
  } catch {
    return { ok: false, error: "X-PAYMENT is not valid base64 JSON" };
  }

  const requirements = buildChallenge(cfg, env, resource).accepts[0];
  const url = `${env.FACILITATOR_URL ?? DEFAULT_FACILITATOR}/verify`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x402Version: 1, paymentPayload: payload, paymentRequirements: requirements }),
    });
    if (!res.ok) {
      return { ok: false, error: `facilitator ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const body = (await res.json()) as { isValid?: boolean; invalidReason?: string; txid?: string };
    return body.isValid
      ? { ok: true, txid: body.txid }
      : { ok: false, error: body.invalidReason ?? "payment rejected" };
  } catch (e) {
    return { ok: false, error: `facilitator unreachable: ${(e as Error).message}` };
  }
}

/** Send the 402, with the challenge as the body. */
export const challenge402 = (c: Context, cfg: ProviderConfig, env: ProviderEnv) =>
  c.json(buildChallenge(cfg, env, c.req.url), 402);
