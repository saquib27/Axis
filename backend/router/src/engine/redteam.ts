/**
 * Red-team harness. Phase A.
 *
 * Fires the paper's attacks (arXiv:2605.11781) at our OWN live providers and
 * reports whether each was blocked. These are real HTTP requests carrying real
 * settled-payment proofs — not mocks.
 */
import { formatUSDC, microUSDC } from "@axis/shared";
import type { Config } from "../config.ts";
import { agentAccount } from "../chain/client.ts";

export interface AttackResult {
  fired: number; blocked: number; granted: number;
  mitigation: string; detail: string; sample?: string[];
}

/** Settle one real USDC payment to a provider's payee; return the txid. */
async function settleOneLeg(cfg: Config, payToEnv: string, priceMicro: bigint): Promise<string> {
  const { algo, agent } = agentAccount(cfg);
  const payTo = process.env[payToEnv]!;
  const r = await algo.newGroup()
    .addAssetTransfer({ sender: agent.addr as never, receiver: payTo, assetId: BigInt(cfg.USDC_ASA_ID), amount: microUSDC(priceMicro), signer: agent.signer as never })
    .send();
  return r.txIds[0]!;
}

/** Settle ONE real payment up front, so the actual attack click is instant.
 *  Returned proof is fired unchanged by replay() — no on-chain wait on click. */
export async function primePayment(cfg: Config): Promise<string> {
  const txid = await settleOneLeg(cfg, "PAY_TO_DIFF", 30_000n);
  return btoa(JSON.stringify({ txid }));
}

/** ATTACK II — replay the SAME payment N times concurrently.
 *  If `proof` is supplied (from a prior prime), we skip the slow settle. */
export async function replay(cfg: Config, opts: { proof?: string; n?: number } = {}): Promise<AttackResult> {
  const n = opts.n ?? 12;
  const base = cfg.PROVIDER_DIFF_URL;
  const proof = opts.proof ?? await primePayment(cfg);
  // Fire n identical paid requests at once.
  const codes = await Promise.all(Array.from({ length: n }, () =>
    fetch(`${base}/diff/explain`, {
      method: "POST", headers: { "content-type": "application/json", "X-PAYMENT": proof },
      body: JSON.stringify({ diff: "- a\n+ b" }), signal: AbortSignal.timeout(20_000),
    }).then((r) => r.status).catch(() => 0)));
  const granted = codes.filter((c) => c === 200).length;
  const blocked = codes.filter((c) => c === 409).length;
  return {
    fired: n, granted, blocked,
    mitigation: "M3 — single-use claim (KV)",
    detail: granted === 1
      ? `one payment redeemed exactly once; ${blocked} replays refused with PAYMENT_ALREADY_USED`
      : `unexpected: ${granted} grants`,
    sample: [`200×${granted}`, `409×${blocked}`],
  };
}

/** CROSS-RESOURCE — a payment for /diff replayed at /bugsum. */
export async function crossResource(cfg: Config): Promise<AttackResult> {
  const txid = await settleOneLeg(cfg, "PAY_TO_DIFF", 30_000n);
  const proof = btoa(JSON.stringify({ txid, resource: "/diff/explain" }));
  const res = await fetch(`${cfg.PROVIDER_BUGSUM_URL}/bug/summarize`, {
    method: "POST", headers: { "content-type": "application/json", "X-PAYMENT": proof },
    body: JSON.stringify({ report: "x" }), signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json()) as { error?: { code: string } };
  const blocked = res.status === 402 && (body.error?.code === "RESOURCE_MISMATCH" || body.error?.code === "PAYMENT_INVALID");
  return {
    fired: 1, granted: blocked ? 0 : 1, blocked: blocked ? 1 : 0,
    mitigation: "M1 — resource binding",
    detail: blocked ? `payment for /diff rejected at /bugsum (${body.error?.code})` : "NOT blocked — investigate",
  };
}

/** ATTACK III — is a paid response cacheable? */
export async function cacheLeak(cfg: Config): Promise<AttackResult> {
  const res = await fetch(`${cfg.PROVIDER_DIFF_URL}/diff/explain`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000),
  });
  const cc = res.headers.get("cache-control") ?? "";
  const vary = res.headers.get("vary") ?? "";
  const safe = cc.includes("no-store") && vary.toLowerCase().includes("x-payment");
  return {
    fired: 1, granted: safe ? 0 : 1, blocked: safe ? 1 : 0,
    mitigation: "M5 — no-store + Vary",
    detail: safe ? `Cache-Control: ${cc} · Vary: ${vary} — no shared cache can store this` : "response is cacheable — leak possible",
  };
}

export async function runAttack(id: string, cfg: Config, opts: { proof?: string } = {}): Promise<AttackResult> {
  if (id === "replay") return replay(cfg, { proof: opts.proof });
  if (id === "cross-resource") return crossResource(cfg);
  if (id === "cache") return cacheLeak(cfg);
  return { fired: 0, granted: 0, blocked: 0, mitigation: "", detail: `unknown attack ${id}` };
}
