/** Recover interrupted payments without reporting undelivered services as success. */
import { eq, inArray } from "drizzle-orm";
import { db } from "./db/client.ts";
import { runs, legs } from "./db/schema.ts";
import type { Config } from "./config.ts";

export async function reconcilePending(cfg: Config): Promise<number> {
  const database = db(cfg.DATABASE_URL);
  const stuck = await database.select().from(runs).where(inArray(runs.status, ["PENDING", "RECOVERY_REQUIRED"]));
  let fixed = 0;
  for (const run of stuck) {
    if (run.finishedAt) continue;
    const payments = await database.select().from(legs).where(eq(legs.runId, run.id));
    if (!payments.length || payments.some((leg) => !leg.txid)) continue;
    try {
      const confirmed = await Promise.all(payments.map(async (leg) => {
        const response = await fetch(`${cfg.INDEXER_URL}/v2/transactions/${encodeURIComponent(leg.txid!)}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error("payment confirmation unavailable");
        const body = await response.json() as { transaction?: { "confirmed-round"?: number; group?: string } };
        if (!body.transaction?.["confirmed-round"]) throw new Error("payment is not confirmed");
        return body.transaction;
      }));
      // Do not replay providers or refunds: a lost response may already have
      // consumed the proof or issued compensation. Retain each stored result.
      const delivered = payments.every((leg) => leg.status === "DELIVERED");
      const refundedMicro = payments.reduce((sum, leg) => sum + (leg.compensationTxid ? leg.priceMicro : 0n), 0n);
      await database.update(runs).set({
        status: delivered ? "SETTLED" : "PARTIAL", refundedMicro,
        groupId: confirmed[0].group ?? run.groupId,
        confirmedRound: BigInt(confirmed[0]["confirmed-round"]!), finishedAt: new Date(),
        error: delivered ? null : { code: "DELIVERY_INTERRUPTED", message: "payment confirmed; inspect unfinished provider delivery before retrying" },
      }).where(eq(runs.id, run.id));
      fixed++;
    } catch { /* Unknown payment state: retain reservation; never claim zero cost. */ }
  }
  return fixed;
}
