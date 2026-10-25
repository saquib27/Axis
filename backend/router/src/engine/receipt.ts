/** Build the unified receipt from runs + legs. The artifact that proves it all. */
import { eq, desc, gt, and, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { formatUSDC, microUSDC } from "@axis/shared";
import { db } from "../db/client.ts";
import { runs, legs as legsTable, projects, quotes } from "../db/schema.ts";

const explorer = (t: string) => `https://lora.algokit.io/testnet/transaction/${t}`;

export async function buildReceipt(runId: string, databaseUrl: string, apiKey?: string) {
  const database = db(databaseUrl);
  const run = (await database.select().from(runs).where(eq(runs.id, runId)))[0];
  if (!run || !apiKey || run.apiKey !== apiKey) return null;
  const legRows = await database.select().from(legsTable).where(eq(legsTable.runId, runId));

  const legs = legRows.map((l) => ({
    stepId: l.stepId, provider: l.provider, payTo: l.payTo,
    priceUSDC: formatUSDC(microUSDC(l.priceMicro)),
    txid: l.txid ?? "", explorerUrl: l.txid ? explorer(l.txid) : "",
    status: l.status,
    // The FULL provider output, so the receipt shows the actual result — not a
    // 120-char preview cut off mid-sentence.
    result: l.result ?? null,
    ...(l.compensationTxid ? { compensationTxid: l.compensationTxid, compensationExplorerUrl: explorer(l.compensationTxid) } : {}),
    ...(l.latencyMs != null ? { latencyMs: l.latencyMs } : {}),
  }));

  return {
    receiptId: run.id,
    workflow: run.workflow,
    status: run.status,
    groupId: run.groupId ?? "",
    confirmedRound: run.confirmedRound != null ? Number(run.confirmedRound) : undefined,
    agentAddress: run.agentAddress,
    signatureCount: 1 as const,
    legs,
    totalUSDC: formatUSDC(microUSDC(run.totalMicro)),
    refundedUSDC: formatUSDC(microUSDC(run.refundedMicro)),
    createdAt: run.startedAt.toISOString(),
  };
}

/** Every run in the DB, newest first — the "all receipts" index. */
export async function listReceipts(databaseUrl: string, limit = 100, apiKey?: string) {
  const database = db(databaseUrl);
  const rows = await database
    .select()
    .from(runs)
    .where(apiKey ? eq(runs.apiKey, apiKey) : undefined)
    .orderBy(desc(runs.startedAt))
    .limit(limit);
  return rows.map((r) => ({
    receiptId: r.id,
    workflow: r.workflow,
    status: r.status,
    agentAddress: r.agentAddress,
    groupId: r.groupId ?? "",
    projectId: r.projectId ?? null,
    totalUSDC: formatUSDC(microUSDC(r.totalMicro)),
    refundedUSDC: formatUSDC(microUSDC(r.refundedMicro)),
    createdAt: r.startedAt.toISOString(),
  }));
}

/** Every run that got money back on chain — the refunds view. */
export async function listRefunds(databaseUrl: string, limit = 100, apiKey?: string) {
  const database = db(databaseUrl);
  const rows = await database.select().from(runs)
    .where(apiKey ? and(gt(runs.refundedMicro, 0n), eq(runs.apiKey, apiKey)) : gt(runs.refundedMicro, 0n))
    .orderBy(desc(runs.startedAt)).limit(limit);
  return rows.map((r) => ({
    receiptId: r.id,
    workflow: r.workflow,
    status: r.status,
    refundedUSDC: formatUSDC(microUSDC(r.refundedMicro)),
    totalUSDC: formatUSDC(microUSDC(r.totalMicro)),
    projectId: r.projectId ?? null,
    createdAt: r.startedAt.toISOString(),
  }));
}

/** Aggregate spend for one account (by API key) or across everything. */
export async function usageSummary(databaseUrl: string, apiKey?: string) {
  const database = db(databaseUrl);
  // Totals only need status + the two money columns; skip the jsonb payloads.
  const rows = await database
    .select({ status: runs.status, totalMicro: runs.totalMicro, refundedMicro: runs.refundedMicro })
    .from(runs)
    .where(apiKey ? eq(runs.apiKey, apiKey) : undefined);
  let gross = 0n, refunded = 0n, settled = 0, partial = 0, failed = 0;
  for (const r of rows) {
    if (r.status === "SETTLED" || r.status === "PARTIAL" || r.status === "RECOVERY_REQUIRED") { gross += r.totalMicro; refunded += r.refundedMicro; }
    if (r.status === "SETTLED") settled++;
    else if (r.status === "PARTIAL") partial++;
    else if (r.status === "FAILED") failed++;
  }
  return {
    runs: rows.length, settled, partial, failed,
    grossUSDC: formatUSDC(microUSDC(gross)),
    refundedUSDC: formatUSDC(microUSDC(refunded)),
    netUSDC: formatUSDC(microUSDC(gross - refunded)),
  };
}

const projectTotals = (rs: { status: string; totalMicro: bigint; refundedMicro: bigint }[]) => {
  let gross = 0n, refunded = 0n;
  const reservedMicro = rs.filter((r) => r.status === "PENDING").reduce((sum, r) => sum + r.totalMicro, 0n);
  for (const r of rs) if (r.status === "SETTLED" || r.status === "PARTIAL" || r.status === "RECOVERY_REQUIRED") { gross += r.totalMicro; refunded += r.refundedMicro; }
  return {
    runs: rs.length, grossMicro: gross, reservedMicro,
    grossUSDC: formatUSDC(microUSDC(gross)),
    refundedUSDC: formatUSDC(microUSDC(refunded)),
    netUSDC: formatUSDC(microUSDC(gross - refunded)),
  };
};

/** Fold a project's optional budget ceiling + its gross spend into public fields.
 *  No budget set → both null: the project has no ceiling of its own, only the
 *  server's spend-policy limits apply. */
function withBudget(p: { budgetMicro: bigint | null }, totals: ReturnType<typeof projectTotals>) {
  const { grossMicro, reservedMicro, ...rest } = totals;
  if (p.budgetMicro == null) return { ...rest, budgetUSDC: null as string | null, remainingUSDC: null as string | null };
  const remaining = p.budgetMicro - grossMicro - reservedMicro;
  return {
    ...rest,
    budgetUSDC: formatUSDC(microUSDC(p.budgetMicro)),
    remainingUSDC: formatUSDC(microUSDC(remaining > 0n ? remaining : 0n)),
  };
}

/** Create a named project to group runs under. Owned by the calling account.
 *  An optional total budget makes the autonomous agent's per-run spend
 *  automatic — see `projectHeadroomMicro`. */
export async function createProject(databaseUrl: string, name: string, agentAddress?: string, apiKey?: string, budgetUSDC?: number) {
  const database = db(databaseUrl);
  const id = `proj_${randomUUID().slice(0, 12)}`;
  const createdAt = new Date();
  const budgetMicro = budgetUSDC != null && budgetUSDC > 0 ? BigInt(Math.round(budgetUSDC * 1e6)) : null;
  await database.insert(projects).values({ id, name, agentAddress: agentAddress ?? null, apiKey: apiKey ?? null, budgetMicro, createdAt });
  return {
    id, name, agentAddress: agentAddress ?? null, createdAt: createdAt.toISOString(),
    ...withBudget({ budgetMicro }, projectTotals([])),
  };
}

/** Every project with its rolled-up spend + refunds (scoped to one account if given). */
export async function listProjects(databaseUrl: string, apiKey?: string) {
  const database = db(databaseUrl);
  // Only the four columns the totals need — not every run row with its jsonb.
  const runCols = { projectId: runs.projectId, status: runs.status, totalMicro: runs.totalMicro, refundedMicro: runs.refundedMicro };
  const [projs, accountRuns] = await Promise.all([
    database.select().from(projects)
      // An account sees the projects it owns; rows created before ownership
      // existed have no api_key and stay visible via their runs below.
      .where(apiKey ? eq(projects.apiKey, apiKey) : undefined)
      .orderBy(desc(projects.createdAt)),
    database.select(runCols).from(runs).where(apiKey ? eq(runs.apiKey, apiKey) : undefined),
  ]);
  const byProject = new Map<string, typeof accountRuns>();
  for (const r of accountRuns) {
    if (!r.projectId) continue;
    const rs = byProject.get(r.projectId) ?? [];
    rs.push(r);
    byProject.set(r.projectId, rs);
  }
  const list = projs.map((p) => ({
    id: p.id, name: p.name, createdAt: p.createdAt.toISOString(),
    ...withBudget(p, projectTotals(byProject.get(p.id) ?? [])),
  }));
  if (!apiKey) return list;
  // Legacy, unowned projects this account has actually run against.
  const owned = new Set(list.map((p) => p.id));
  const orphanIds = [...byProject.keys()].filter((id) => !owned.has(id));
  if (!orphanIds.length) return list;
  const orphans = await database.select().from(projects).where(and(inArray(projects.id, orphanIds), eq(projects.apiKey, apiKey)));
  return [...list, ...orphans.map((p) => ({
    id: p.id, name: p.name, createdAt: p.createdAt.toISOString(),
    ...withBudget(p, projectTotals(byProject.get(p.id) ?? [])),
  }))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Best-effort one-line prompt preview for a run — whatever text the caller
 *  actually typed (diff / commitMessage / goal), pulled from its stored quote. */
function promptPreview(inputs: Record<string, unknown> | undefined): string {
  if (!inputs) return "";
  const v = inputs.commitMessage ?? inputs.diff ?? inputs.goal ?? inputs.text ?? Object.values(inputs)[0];
  return typeof v === "string" ? v.slice(0, 160) : "";
}

/** One project with its runs and totals — the per-project detail view. Doubles
 *  as the project's live "memory": every task/prompt run under it, in order.
 *
 *  Scoped: knowing a project id is not authorisation to read it. A caller sees
 *  a project only if they own it, or (for rows created before ownership
 *  existed) if the runs under it are theirs. */
export async function projectDetail(databaseUrl: string, id: string, apiKey?: string) {
  const database = db(databaseUrl);
  const p = (await database.select().from(projects).where(eq(projects.id, id)))[0];
  if (!p) return null;
  const rs = await database.select().from(runs)
    .where(apiKey ? and(eq(runs.projectId, id), eq(runs.apiKey, apiKey)) : eq(runs.projectId, id))
    .orderBy(desc(runs.startedAt));
  // Not the owner, and none of this project's runs are yours → it isn't yours.
  if (apiKey && p.apiKey !== apiKey) return null;
  // A refused or policy-blocked run never reached a quote, so it has no
  // quoteId — those rows carry their reason in `error` instead.
  const quoteIds = rs.map((r) => r.quoteId).filter((id): id is string => !!id);
  const quoteRows = quoteIds.length
    ? await database.select({ id: quotes.id, inputs: quotes.inputs }).from(quotes).where(inArray(quotes.id, quoteIds))
    : [];
  const inputsByQuoteId = new Map(quoteRows.map((q) => [q.id, q.inputs as Record<string, unknown>]));
  return {
    id: p.id, name: p.name, createdAt: p.createdAt.toISOString(),
    totals: withBudget(p, projectTotals(rs)),
    runs: rs.map((r) => ({
      receiptId: r.id, workflow: r.workflow, status: r.status,
      // Show why it was refused when there is no prompt to show.
      prompt: (r.quoteId ? promptPreview(inputsByQuoteId.get(r.quoteId)) : "")
        || (r.error as { message?: string } | null)?.message || "",
      totalUSDC: formatUSDC(microUSDC(r.totalMicro)),
      refundedUSDC: formatUSDC(microUSDC(r.refundedMicro)),
      createdAt: r.startedAt.toISOString(),
    })),
  };
}

/** The autonomous agent's automatic ceiling for a project: whatever headroom
 *  is left under its budget. Null when the project has no budget of its own —
 *  the caller then falls back to the server's spend-policy limits alone. */
export async function projectHeadroomMicro(databaseUrl: string, projectId: string): Promise<bigint | null> {
  const database = db(databaseUrl);
  const p = (await database.select().from(projects).where(eq(projects.id, projectId)))[0];
  if (!p || p.budgetMicro == null) return null;
  const rs = await database
    .select({ status: runs.status, totalMicro: runs.totalMicro, refundedMicro: runs.refundedMicro })
    .from(runs).where(eq(runs.projectId, projectId));
  const { grossMicro, reservedMicro } = projectTotals(rs);
  const remaining = p.budgetMicro - grossMicro - reservedMicro;
  return remaining > 0n ? remaining : 0n;
}
