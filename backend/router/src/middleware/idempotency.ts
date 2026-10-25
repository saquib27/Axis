/**
 * Idempotency for execute. Phase 8.
 *
 * A CI pipeline that retries a request — network timeout, redelivery, a flaky
 * runner — must NOT pay twice. The quote's single-use OPEN->CONSUMED guard stops
 * a replay of the SAME quote, but a client that lost the response and retries
 * needs the SAME answer back, not a second settlement.
 *
 * Keyed on the client's Idempotency-Key: first request runs and stores its
 * response; any repeat returns the stored response verbatim.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { idempotencyKeys } from "../db/schema.ts";
import type { Config } from "../config.ts";

export async function getStored(key: string, cfg: Config): Promise<unknown | null> {
  const row = (await db(cfg.DATABASE_URL).select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)))[0];
  return row ? row.response : null;
}

export async function store(key: string, runId: string, response: unknown, cfg: Config): Promise<void> {
  await db(cfg.DATABASE_URL).insert(idempotencyKeys)
    .values({ key, runId, response: response as object })
    .onConflictDoNothing();
}
