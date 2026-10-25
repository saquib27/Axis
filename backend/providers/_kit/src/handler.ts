/**
 * The generic paid-endpoint pipeline.
 *
 * The ORDER of these steps is the security property, and it is derived from
 * "Five Attacks on x402 Agentic Payment Protocol" (arXiv:2605.11781), whose
 * audit found every SDK they tested (TypeScript, Python, Rust) failing at least
 * three of these checks:
 *
 *   1. challenge if unpaid          — the x402 entry point
 *   2. validate + size-cap input    — before spending anything
 *   3. RESOURCE BINDING     (M1)    — payment signed for THIS endpoint
 *   4. FRESHNESS            (M1)    — challenge not expired
 *   5. SINGLE-USE CLAIM     (M3)    — atomically, BEFORE any grant
 *   6. verify payment               — facilitator
 *   7. call the model               — only now does anything cost money
 *   8. no-store on the response (M5)
 *
 * Steps 3-5 all happen BEFORE step 6. That is deliberate: they are cheap, local,
 * and each one closes an attack that a later check cannot.
 */
import type { Context } from "hono";
import { z } from "zod";
import { challenge402, verifyPayment, type ProviderConfig, type ProviderEnv } from "./x402.ts";

/** price in microUSDC from the provider config (e.g. "0.03" -> 30000). */
function buildChallengeAmount(cfg: ProviderConfig): string {
  const [w = "0", f = ""] = cfg.priceUSDC.split(".");
  return (BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0") || "0")).toString();
}
import { getClaimStore, claimKey, paymentIdentity } from "./claims.ts";
import { isOnChainProof, verifyOnChain } from "./onchain.ts";

/** Cap request size so a caller cannot run up our token bill on one call. */
const MAX_INPUT_CHARS = 24_000;

/** Claim TTL. Must exceed the challenge's maxTimeoutSeconds (60) so a claim
 *  cannot expire while the original payment is still considered fresh. */
const CLAIM_TTL_SECONDS = 900;

export interface HandlerDeps<I, O> {
  cfg: ProviderConfig;
  input: z.ZodType<I>;
  run: (input: I, env: ProviderEnv) => Promise<O>;
}

const fail = (c: Context, status: 400 | 402 | 409 | 502, code: string, message: string, extra = {}) =>
  c.json({ error: { code, message, ...extra } }, status);

export async function paidHandler<I, O>(
  c: Context,
  { cfg, input, run }: HandlerDeps<I, O>,
): Promise<Response> {
  const env = c.env as ProviderEnv;

  // Every response from a paid route is uncacheable, including the 402 and the
  // error paths. M5 / Attack III-D2: the paper measured 100% leakage of paid
  // content to unpaid clients through an nginx cache with no such header, and
  // found NO audited SDK setting it. Set it once, at the top, so no branch can
  // return without it.
  c.header("Cache-Control", "no-store, private");
  c.header("Vary", "X-PAYMENT");

  // ── 1. Unpaid -> issue the challenge ──────────────────────────────────
  const header = c.req.header("X-PAYMENT");
  if (!header) return challenge402(c, cfg, env);

  // ── 2. Validate the body BEFORE spending anything ─────────────────────
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return fail(c, 400, "INVALID_INPUT", "body must be JSON");
  }

  const raw = JSON.stringify(body);
  if (raw.length > MAX_INPUT_CHARS) {
    // Reject rather than silently truncate: a caller who paid deserves either
    // a real answer or a clear refusal, never a quietly degraded one.
    return fail(c, 400, "INPUT_TOO_LARGE",
      `input is ${raw.length} chars; limit is ${MAX_INPUT_CHARS}`);
  }

  const parsed = input.safeParse(body);
  if (!parsed.success) {
    return fail(c, 400, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "invalid");
  }

  // ── 3-5. Cheap local checks that close real attacks ───────────────────
  let payload: unknown;
  try {
    payload = JSON.parse(atob(header));
  } catch {
    return fail(c, 402, "PAYMENT_INVALID", "X-PAYMENT is not valid base64 JSON");
  }

  // M1 — RESOURCE BINDING. Without this, a payment signed for /diff/explain is
  // replayable against /bug/summarize on the same origin. The paper found this
  // missing in EVERY SDK audited (severity: Critical), and confirmed a payment
  // for resource A working on resources B, C and D of a live endpoint.
  const requestedResource = new URL(c.req.url).pathname;
  const signedResource = extractResource(payload);
  if (signedResource && new URL(signedResource, c.req.url).pathname !== requestedResource) {
    return fail(c, 402, "RESOURCE_MISMATCH",
      `payment was signed for ${signedResource}, not ${requestedResource}`);
  }

  // M3 — SINGLE-USE CLAIM, taken BEFORE the grant and before we even ask the
  // facilitator. Attack II: without this, one payment yields one grant per
  // replay (the paper observed 248 grants from a single payment). The chain's
  // nonce check does NOT cover this — it protects contract state, not the
  // HTTP grant.
  const payId = paymentIdentity(payload);
  if (!payId) {
    return fail(c, 402, "PAYMENT_INVALID", "could not derive a payment identity");
  }
  const claimed = await getClaimStore(env).claim(
    claimKey(payId, requestedResource),
    CLAIM_TTL_SECONDS,
  );
  if (!claimed) {
    return fail(c, 409, "PAYMENT_ALREADY_USED",
      "this payment has already been redeemed for this resource");
  }

  // ── 6. Verify payment. Still no model call. ───────────────────────────
  // Aggregator model: the router already settled the atomic group, so the
  // proof is a settled txid we confirm on-chain. Fall back to the facilitator
  // for the classic single-payment (pre-settle) flow.
  let paymentTxid: string | null = null;
  if (isOnChainProof(payload)) {
    const price = BigInt((buildChallengeAmount(cfg)));
    const asset = String((env.USDC_ASA_ID ?? "10458941"));
    const payTo = String(env[cfg.payToEnvKey]);
    const chk = await verifyOnChain(payload.txid, { payTo, minAmount: price, asset });
    if (!chk.ok) return fail(c, 402, "PAYMENT_INVALID", chk.error ?? "on-chain verification failed");
    paymentTxid = payload.txid;
  } else {
    const payment = await verifyPayment(header, cfg, env, c.req.url);
    if (!payment.ok) return fail(c, 402, "PAYMENT_INVALID", payment.error ?? "payment rejected");
    paymentTxid = payment.txid ?? null;
  }

  // ── 7. Paid, bound, fresh and single-use. Now do the work. ────────────
  const started = Date.now();
  try {
    const result = await run(parsed.data, env);
    c.header("X-PAYMENT-RESPONSE", btoa(JSON.stringify({ txid: paymentTxid })));
    return c.json({ provider: cfg.name, result, latencyMs: Date.now() - started });
  } catch (e) {
    // Payment settled but we failed to deliver. 502 + paid:true is the signal
    // the router uses to issue a compensation leg and mark the run PARTIAL.
    return fail(c, 502, "PROVIDER_EXECUTION_FAILED", (e as Error).message, { paid: true });
  }
}

/** Pull the signed `resource` out of a payment payload, wherever it sits. */
function extractResource(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  for (const candidate of [p, p.payload, p.paymentRequirements]) {
    if (candidate && typeof candidate === "object") {
      const r = (candidate as Record<string, unknown>).resource;
      if (typeof r === "string" && r.length > 0) return r;
    }
  }
  return null;
}
