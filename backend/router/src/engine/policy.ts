/**
 * Policy evaluation for the router — the pure guard + the one velocity query.
 * Runs at quote time; a FAIL blocks execute so nothing is ever signed.
 */
import { sql, and, gt, eq, or, inArray } from "drizzle-orm";
import { evaluate, trustScore, type PolicyVerdict, type SpendPolicy } from "@axis/guard";
import type { Config } from "../config.ts";
import { db } from "../db/client.ts";
import { spendEvents, policies, runs } from "../db/schema.ts";
import type { QuoteLegResolved } from "./quote.ts";
import { emit } from "../bus.ts";

/** Rolling-hour velocity: one indexed query, O(window) not O(history). */
async function velocity(agentAddress: string, cfg: Config, database: Pick<ReturnType<typeof db>, "select">) {
  const rows = await database
    .select({
      spent: sql<string>`coalesce(sum(${spendEvents.amountMicro}), 0)`,
      calls: sql<number>`count(*)::int`,
    })
    .from(spendEvents)
    .leftJoin(runs, eq(runs.id, spendEvents.runId))
    .where(and(eq(spendEvents.agentAddress, agentAddress), or(
      gt(spendEvents.createdAt, sql`now() - interval '1 hour'`),
      inArray(runs.status, ["PENDING", "RECOVERY_REQUIRED"]),
    )));
  return { spentLastHourMicro: BigInt(rows[0]?.spent ?? "0"), callsLastHour: rows[0]?.calls ?? 0 };
}

async function loadPolicy(agentAddress: string, cfg: Config, database: Pick<ReturnType<typeof db>, "select">): Promise<SpendPolicy> {
  const row = (await database.select().from(policies).where(eq(policies.agentAddress, agentAddress)))[0];
  if (!row) {
    // Lazily seed defaults, tightened by config.
    return {
      maxWorkflowMicro: cfg.MAX_WORKFLOW_SPEND_MICRO,
      maxProviderMicro: cfg.MAX_PROVIDER_SPEND_MICRO,
      maxHourlySpendMicro: cfg.MAX_HOURLY_SPEND_MICRO,
      maxHourlyCalls: cfg.MAX_HOURLY_CALLS,
      minProviderTrust: cfg.MIN_PROVIDER_TRUST,
      killSwitch: cfg.KILL_SWITCH,
    };
  }
  return {
    maxWorkflowMicro: row.maxWorkflowMicro, maxProviderMicro: row.maxProviderMicro,
    maxHourlySpendMicro: row.maxHourlySpendMicro, maxHourlyCalls: row.maxHourlyCalls,
    minProviderTrust: row.minProviderTrust, killSwitch: row.killSwitch,
  };
}

export async function evaluatePolicy(
  agentAddress: string, legs: QuoteLegResolved[], grandTotalMicro: bigint,
  clientMaxMicro: bigint | undefined, cfg: Config, runId: string,
  database: Pick<ReturnType<typeof db>, "select"> = db(cfg.DATABASE_URL),
): Promise<PolicyVerdict> {
  const [policy, hist] = await Promise.all([loadPolicy(agentAddress, cfg, database), velocity(agentAddress, cfg, database)]);
  const verdict = evaluate(
    {
      grandTotalMicro, clientMaxMicro,
      legs: legs.map((l) => ({ provider: l.provider, priceMicro: l.priceMicro, trustScore: trustScore(l.provider) })),
    },
    policy, hist,
  );
  emit(runId, {
    type: "policy.evaluated", step: "policy",
    verdict: verdict.verdict, checks: verdict.checks, violations: verdict.violations,
  });
  return verdict;
}
