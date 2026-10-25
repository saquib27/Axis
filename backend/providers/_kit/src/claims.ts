/**
 * Pre-grant single-use claims — mitigation M3 from "Five Attacks on x402
 * Agentic Payment Protocol" (Li, Wang & Wang, arXiv:2605.11781).
 *
 * ── The attack (Attack II, §3.2) ──────────────────────────────────────────
 * X-PAYMENT is a BEARER capability. If the server does not atomically record
 * that a payment identity has been used BEFORE releasing the resource, the same
 * header can be replayed n times and produce n grants. The chain still settles
 * only once, so the on-chain nonce check does not save you — it protects
 * contract state, not the HTTP grant.
 *
 * The paper measured this against a live endpoint: 1,000 concurrent replays of
 * ONE payment produced 248 HTTP grants and 1 settlement. Their SDK audit found
 * pay_id idempotency MISSING in all three x402 SDKs they tested (TypeScript,
 * Python, Rust). Severity: Critical.
 *
 * ── The fix ──────────────────────────────────────────────────────────────
 * Claim the (pay_id, resource_id) pair atomically BEFORE any grant. Two
 * distinct checks, in this order:
 *
 *   1. RESOURCE BINDING  — the payment was signed for THIS endpoint. Without
 *      it, a payment for /diff/explain can be replayed against /bug/summarize.
 *      The paper found this missing in every SDK audited.
 *   2. SINGLE-USE CLAIM  — this pay_id has not already been granted, within a
 *      TTL longer than the payment's own freshness window.
 *
 * Ordering is the property. A claim taken *after* the grant is not a claim.
 */

export interface ClaimStore {
  /** Returns true if the claim was taken, false if it was already held. */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
}

/**
 * Cloudflare KV-backed store. `expiration_ttl` gives us automatic cleanup.
 *
 * KV is eventually consistent, so two truly simultaneous replays could in
 * principle both see an empty slot. That window is small and bounded, and it is
 * an enormous improvement over no check at all — but a Durable Object is the
 * strictly-correct choice if we later need linearizable claims.
 */
export class KvClaimStore implements ClaimStore {
  // Explicit field, NOT a `constructor(private readonly kv)` parameter
  // property. Parameter properties require code GENERATION; Node's type
  // stripping only erases, so they throw ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX at
  // runtime. See also LlmError in llm.ts.
  private readonly kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    if ((await this.kv.get(key)) !== null) return false;
    await this.kv.put(key, "1", { expirationTtl: Math.max(60, ttlSeconds) });
    return true;
  }
}

/**
 * In-memory fallback for local dev.
 *
 * Deliberately NOT silent: an operator who ships this to production has a
 * replayable endpoint the moment a second Worker isolate spins up, so it says
 * so out loud on first use.
 */
export class MemoryClaimStore implements ClaimStore {
  private readonly seen = new Map<string, number>();
  private warned = false;

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    if (!this.warned) {
      console.warn(
        "[axis] claims are IN-MEMORY. Replay protection does not survive " +
          "isolate restarts and is not shared across isolates. Bind a KV " +
          "namespace named AXIS_CLAIMS before deploying.",
      );
      this.warned = true;
    }
    const now = Date.now();
    for (const [k, exp] of this.seen) if (exp < now) this.seen.delete(k);
    if (this.seen.has(key)) return false;
    this.seen.set(key, now + ttlSeconds * 1000);
    return true;
  }
}

const memory = new MemoryClaimStore();

/**
 * In-isolate memory claim IN FRONT of KV.
 *
 * The claim() below is synchronous up to the first await: it reserves the key
 * in a plain Map before yielding, so N concurrent requests in the same isolate
 * serialize and only the first proceeds. KV (eventually consistent) then guards
 * across isolates and restarts. Together they block the concurrent replay flood
 * that KV alone races on.
 */
class LayeredClaimStore implements ClaimStore {
  private readonly mem = new Map<string, number>();
  private readonly kv: KVNamespace;
  constructor(kv: KVNamespace) { this.kv = kv; }

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    // Synchronous reserve — no await before this, so concurrent calls in this
    // isolate cannot both pass.
    const held = this.mem.get(key);
    if (held && held > now) return false;
    this.mem.set(key, now + ttlSeconds * 1000);

    // Cross-isolate durability via KV.
    if ((await this.kv.get(key)) !== null) return false;
    await this.kv.put(key, "1", { expirationTtl: Math.max(60, ttlSeconds) });
    return true;
  }
}

export function getClaimStore(env: { AXIS_CLAIMS?: KVNamespace; CLAIM_DO?: DurableObjectNamespace }): ClaimStore {
  if (env.CLAIM_DO) return new DurableClaimStore(env.CLAIM_DO);
  if (env.AXIS_CLAIMS) return new LayeredClaimStore(env.AXIS_CLAIMS);
  return memory;
}

/**
 * Derive the claim key. Binding BOTH identifiers is the point: keying on
 * pay_id alone still permits cross-resource reuse, and keying on resource
 * alone blocks legitimate distinct payments for the same endpoint.
 */
export const claimKey = (payId: string, resourceId: string): string =>
  `claim:${payId}:${resourceId}`;

/**
 * Extract a stable payment identity from the decoded X-PAYMENT payload.
 *
 * The paper (§3.2) warns that hashing raw header BYTES lets replay hide inside
 * re-serialization — different JSON key order or whitespace is a different byte
 * string but the same logical payment. So we key on protocol fields, and fall
 * back to a canonical (sorted-key) serialization rather than the raw bytes.
 */
export function paymentIdentity(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  const direct = p.payment_id ?? p.paymentId ?? p.nonce;
  if (typeof direct === "string" && direct.length > 0) return direct;

  // AVM: the atomic group plus this leg's index uniquely identifies the payment.
  const inner = (p.payload ?? p) as Record<string, unknown>;
  const group = inner.paymentGroup;
  const index = inner.paymentIndex;
  if (Array.isArray(group) && typeof index === "number" && group[index]) {
    return `avm:${index}:${String(group[index]).slice(0, 96)}`;
  }

  try {
    return `canon:${canonicalize(payload)}`.slice(0, 256);
  } catch {
    return null;
  }
}

/** Deterministic serialization: sorted keys, so re-encoding cannot disguise a replay. */
function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`)
    .join(",")}}`;
}

/**
 * Durable Object claim store — the linearizable fix for CONCURRENT replay.
 *
 * A concurrent burst hits many isolates, so per-isolate memory and eventually-
 * consistent KV both race. A Durable Object is a single globally-unique,
 * single-threaded instance: every claim for a given key routes to the same
 * object and is processed one at a time, so exactly one caller wins. This is
 * what actually blocks the paper's concurrent DGR flood.
 */
export class ClaimDO {
  private readonly storage: DurableObjectStorage;
  constructor(state: DurableObjectState) {
    this.storage = state.storage;
  }
  async fetch(req: Request): Promise<Response> {
    const { key, ttlSeconds } = (await req.json()) as { key: string; ttlSeconds: number };
    const now = Date.now();
    const expiry = (await this.storage.get<number>(key)) ?? 0;
    if (expiry > now) return Response.json({ claimed: false });
    await this.storage.put(key, now + ttlSeconds * 1000);
    return Response.json({ claimed: true });
  }
}

class DurableClaimStore implements ClaimStore {
  private readonly ns: DurableObjectNamespace;
  constructor(ns: DurableObjectNamespace) { this.ns = ns; }
  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    // One DO instance per key → all claims for that key serialize globally.
    const stub = this.ns.get(this.ns.idFromName(key));
    const res = await stub.fetch("https://do/claim", {
      method: "POST", body: JSON.stringify({ key, ttlSeconds }),
    });
    return ((await res.json()) as { claimed: boolean }).claimed;
  }
}
