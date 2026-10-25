/**
 * The quote engine. Phase 3.
 *
 * Fans out UNPAID probes to every provider, reads the price out of each 402
 * challenge, resolves the DAG, sums the cost, and returns a signed quote.
 *
 * The whole point of this phase: ZERO money moves. Price discovery happens by
 * reading each provider's own 402, never by hardcoding a price in the router.
 * That is what makes AXIS a real x402 aggregator rather than a lookup table —
 * change a provider's price and the quote changes with no router redeploy.
 */
import { createHmac, randomUUID } from "node:crypto";
import {
  resolveDag, parseUSDC, formatUSDC, sumUSDC, microUSDC,
  AxisError, ROUTING_FEE_MICRO, QUOTE_TTL_SECONDS,
  type MicroUSDC,
} from "@axis/shared";
import type { Config } from "../config.ts";
import type { WorkflowDef } from "../workflows/pr-review.ts";
import { emit } from "../bus.ts";
import { evaluatePolicy } from "./policy.ts";
import type { PolicyVerdict } from "@axis/guard";

const PROBE_TIMEOUT_MS = 5_000;

export interface QuoteLegResolved {
  stepId: string;
  provider: string;
  payTo: string;
  priceMicro: MicroUSDC;
  asset: string;
  challenge: Record<string, unknown>;
}

export interface Quote {
  quoteId: string;
  workflow: string;
  agentAddress: string;
  network: string;
  dag: { batches: string[][]; edges: { from: string; to: string }[] };
  legs: QuoteLegResolved[];
  subtotalMicro: MicroUSDC;
  routingFeeMicro: MicroUSDC;
  totalMicro: MicroUSDC;
  expiresAt: string;
  policy: PolicyVerdict;
  signature: string;
}

/** Probe one provider unpaid, expect a 402, return its parsed challenge leg. */
async function probe(
  step: WorkflowDef["steps"][number],
  cfg: Config,
  runId: string,
): Promise<QuoteLegResolved> {
  const base = cfg[step.endpointEnv as keyof Config] as string;
  if (!base) {
    throw new AxisError("INVALID_WORKFLOW", `no endpoint configured for ${step.provider}`, {
      env: step.endpointEnv,
    });
  }
  const url = `${base}${step.path}`;

  emit(runId, { type: "probe.sent", step: "discover", stepId: step.id, provider: step.provider });

  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);

  let res: Response;
  try {
    // An unpaid POST with an empty body — we want the 402, not the work.
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: ac.signal,
    });
  } catch (e) {
    throw new AxisError("PROVIDER_UNREACHABLE", `${step.provider} did not respond`, {
      provider: step.provider,
      cause: (e as Error).message,
    });
  } finally {
    clearTimeout(timer);
  }

  if (res.status !== 402) {
    throw new AxisError("CHALLENGE_INVALID",
      `${step.provider} returned ${res.status}, expected 402`, { provider: step.provider });
  }

  const body = (await res.json()) as { accepts?: Array<Record<string, unknown>> };
  const accept = body.accepts?.[0];
  if (!accept || typeof accept.maxAmountRequired !== "string" || typeof accept.payTo !== "string") {
    throw new AxisError("CHALLENGE_INVALID", `${step.provider} sent a malformed 402`, {
      provider: step.provider,
    });
  }

  // Price comes from the challenge, in atomic microUSDC — never hardcoded here.
  const priceMicro = microUSDC(BigInt(accept.maxAmountRequired));
  const latencyMs = Date.now() - started;

  emit(runId, {
    type: "challenge.received",
    step: "challenge",
    stepId: step.id,
    provider: step.provider,
    priceUSDC: formatUSDC(priceMicro),
    payTo: accept.payTo,
    asset: String(accept.asset ?? ""),
    raw: accept,
    latencyMs,
  });

  return {
    stepId: step.id,
    provider: step.provider,
    payTo: accept.payTo,
    priceMicro,
    asset: String(accept.asset ?? ""),
    challenge: accept,
  };
}

/** Canonical bytes we sign, so a tampered quote fails verification on execute. */
export function canonicalQuoteBody(q: Omit<Quote, "signature">): string {
  return JSON.stringify({
    quoteId: q.quoteId,
    workflow: q.workflow,
    agentAddress: q.agentAddress,
    network: q.network,
    legs: q.legs.map((l) => ({ stepId: l.stepId, payTo: l.payTo, price: l.priceMicro.toString() })),
    total: q.totalMicro.toString(),
    expiresAt: q.expiresAt,
  });
}

const sign = (body: string, key: string): string =>
  createHmac("sha256", key).update(body).digest("base64");

export function verifyQuoteSignature(q: Quote, key: string): boolean {
  const expected = sign(canonicalQuoteBody(q), key);
  // Constant-time compare would be nicer; lengths are fixed so this is adequate
  // for a hackathon and the key is server-side only.
  return expected === q.signature;
}

/**
 * Build a signed quote for a workflow.
 *
 * @throws AxisError with a typed code on any discovery/DAG failure — every one
 * of which costs the agent exactly zero, because nothing is paid here.
 */
export async function buildQuote(
  workflow: WorkflowDef,
  agentAddress: string,
  inputs: Record<string, unknown>,
  cfg: Config,
  runId: string,
  clientMaxMicro?: bigint,
): Promise<Quote> {
  // Resolve the DAG first — a bad workflow fails before any network call.
  const dag = resolveDag(workflow.steps);

  // Announce the run up front so the console can draw the whole graph grey
  // before any probe returns.
  emit(runId, {
    type: "run.started", workflow: workflow.id, agentAddress, network: cfg.NETWORK,
    batches: dag.batches, edges: dag.edges,
    nodes: workflow.steps.map((s) => ({ stepId: s.id, provider: s.provider })),
  });

  // Every required input must be present up front, so a step can never be
  // priced and then handed a missing value at execute time.
  for (const step of workflow.steps) {
    for (const [, tmpl] of Object.entries(step.input)) {
      if (typeof tmpl === "string") {
        const m = tmpl.match(/^\$\{\s*inputs\.([A-Za-z0-9_.]+)\s*\}$/);
        if (m && inputs[m[1]!] === undefined) {
          throw new AxisError("MISSING_INPUT", `workflow input "${m[1]}" is required`, {
            reference: `inputs.${m[1]}`,
          });
        }
      }
    }
  }

  // Fan out UNPAID probes in parallel. allSettled so one dead provider gives a
  // clean typed error rather than a partial quote.
  const settled = await Promise.allSettled(
    workflow.steps.map((step) => probe(step, cfg, runId)),
  );
  const failed = settled.find((r) => r.status === "rejected");
  if (failed && failed.status === "rejected") {
    throw failed.reason instanceof AxisError
      ? failed.reason
      : new AxisError("PROVIDER_UNREACHABLE", String(failed.reason));
  }
  const legs = settled.map((r) => (r as PromiseFulfilledResult<QuoteLegResolved>).value);

  const subtotalMicro = sumUSDC(legs.map((l) => l.priceMicro));
  const routingFeeMicro = microUSDC(ROUTING_FEE_MICRO);
  const totalMicro = sumUSDC([subtotalMicro, routingFeeMicro]);

  // ── The Spend Policy Guard — a FAIL here means nothing is ever signed. ──
  const policy = await evaluatePolicy(agentAddress, legs, totalMicro, clientMaxMicro, cfg, runId);

  const quoteId = `qt_${randomUUID().slice(0, 12)}`;
  const expiresAt = new Date(Date.now() + QUOTE_TTL_SECONDS * 1000).toISOString();

  const unsigned: Omit<Quote, "signature"> = {
    quoteId,
    workflow: workflow.id,
    agentAddress,
    network: cfg.NETWORK,
    dag: { batches: dag.batches, edges: dag.edges },
    legs,
    subtotalMicro,
    routingFeeMicro,
    totalMicro,
    expiresAt,
    policy,
  };
  const signature = sign(canonicalQuoteBody(unsigned), cfg.QUOTE_SIGNING_KEY);

  emit(runId, {
    type: "quote.ready",
    step: "quote",
    quoteId,
    legs: legs.map((l) => ({
      stepId: l.stepId, provider: l.provider, payTo: l.payTo, priceUSDC: formatUSDC(l.priceMicro),
    })),
    subtotalUSDC: formatUSDC(subtotalMicro),
    routingFeeUSDC: formatUSDC(routingFeeMicro),
    totalUSDC: formatUSDC(totalMicro),
    expiresAt,
  });

  return { ...unsigned, signature };
}

/** Format a quote for the HTTP response — bigints become decimal strings. */
export function quoteToJson(q: Quote) {
  return {
    quoteId: q.quoteId,
    workflow: q.workflow,
    network: q.network,
    dag: q.dag,
    legs: q.legs.map((l) => ({
      stepId: l.stepId,
      provider: l.provider,
      payTo: l.payTo,
      priceUSDC: formatUSDC(l.priceMicro),
      asset: l.asset,
    })),
    subtotalUSDC: formatUSDC(q.subtotalMicro),
    routingFeeUSDC: formatUSDC(q.routingFeeMicro),
    totalUSDC: formatUSDC(q.totalMicro),
    expiresAt: q.expiresAt,
    policy: q.policy,
    signature: q.signature,
  };
}

export { parseUSDC };


// ── Persistence ──────────────────────────────────────────────────────────
import { db } from "../db/client.ts";
import { quotes } from "../db/schema.ts";

/** Store the signed quote as OPEN. Execute later flips it to CONSUMED once,
 *  which is the single-use guard against replaying a quote into a 2nd settle. */
export async function persistQuote(
  q: Quote,
  inputs: Record<string, unknown>,
  databaseUrl: string,
  apiKey?: string,
  runId?: string,
): Promise<void> {
  await db(databaseUrl).insert(quotes).values({
    id: q.quoteId, apiKey, runId,
    workflow: q.workflow,
    agentAddress: q.agentAddress,
    inputs,
    dag: q.dag,
    legs: q.legs.map((l) => ({
      stepId: l.stepId, provider: l.provider, payTo: l.payTo,
      priceMicro: l.priceMicro.toString(), asset: l.asset, challenge: l.challenge,
    })),
    subtotalMicro: q.subtotalMicro,
    routingFeeMicro: q.routingFeeMicro,
    totalMicro: q.totalMicro,
    policyVerdict: q.policy,
    signature: q.signature,
    status: "OPEN",
    expiresAt: new Date(q.expiresAt),
  });
}
