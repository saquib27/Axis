/**
 * The execute path. Phase 4 — the submission's core claim.
 *
 * Takes a signed quote and: verifies it → single-use guards → pre-flight →
 * composes ONE atomic group across N payees → simulate gate → settle → persist.
 *
 * Every failure before settlement costs the agent exactly zero. That is the
 * whole promise, and each guard below returns a typed error with costedNothing.
 */
import { eq, and, sql, ne } from "drizzle-orm";
import { AxisError, formatUSDC, microUSDC, MAX_GROUP_SIZE } from "@axis/shared";
import { verifyQuoteSignature, type Quote } from "./quote.ts";
import type { Config } from "../config.ts";
import { db } from "../db/client.ts";
import { quotes, runs, legs as legsTable, projects, spendEvents } from "../db/schema.ts";
import { agentAccount } from "../chain/client.ts";
import { preflight, composeGroup, type Leg } from "./compose.ts";
import { simulate, settleWithRetry } from "./settle.ts";
import { runWorkflow } from "./run.ts";
import { emit } from "../bus.ts";
import { accountForKey } from "./auth.ts";
import { evaluatePolicy } from "./policy.ts";

interface StoredLeg {
  stepId: string; provider: string; payTo: string;
  priceMicro: string; asset: string; challenge: Record<string, unknown>;
}

export interface ExecuteResult {
  runId: string;
  groupId: string;
  confirmedRound: number;
  txids: { stepId: string; provider: string; payTo: string; txid: string; amountUSDC: string; explorerUrl: string }[];
  status?: "SETTLED" | "PARTIAL";
  refundedUSDC?: string;
}

const explorer = (t: string) => `https://lora.algokit.io/testnet/transaction/${t}`;

export async function execute(quoteId: string, cfg: Config, runId: string, chaosStep?: string, projectId?: string, apiKey?: string): Promise<ExecuteResult> {
  const database = db(cfg.DATABASE_URL);
  if (!apiKey || !await accountForKey(apiKey, cfg.DATABASE_URL)) throw new AxisError("UNAUTHORIZED", "a valid account API key is required");

  // ── 1. Load the quote ──────────────────────────────────────────────────
  const row = (await database.select().from(quotes).where(eq(quotes.id, quoteId)))[0];
  if (!row || row.apiKey !== apiKey) throw new AxisError("QUOTE_NOT_FOUND", `no quote ${quoteId}`);

  const payerAddress = String(agentAccount(cfg).agent.addr);
  if (row.agentAddress !== payerAddress) throw new AxisError("INVALID_INPUT", "quote payer does not match the router wallet");
  if (row.runId) runId = row.runId;

  // ── 2. Single-use + expiry guards, BEFORE anything moves ───────────────
  if (row.status !== "OPEN") {
    throw new AxisError("QUOTE_CONSUMED", `quote ${quoteId} is ${row.status}`);
  }
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    throw new AxisError("QUOTE_EXPIRED", `quote ${quoteId} expired at ${row.expiresAt.toISOString()}`);
  }
  const verdict = row.policyVerdict as { verdict?: string; violations?: string[] };
  if (verdict?.verdict === "FAIL") {
    throw new AxisError("POLICY_VIOLATION",
      verdict.violations?.[0] ?? "spend policy rejected this workflow", { violations: verdict.violations });
  }

  // ── 3. Verify the router's own signature (tamper guard) ────────────────
  const stored: StoredLeg[] = row.legs as StoredLeg[];
  const reconstructed: Quote = {
    quoteId: row.id,
    workflow: row.workflow,
    agentAddress: row.agentAddress,
    network: cfg.NETWORK,
    dag: row.dag as Quote["dag"],
    legs: stored.map((l) => ({
      stepId: l.stepId, provider: l.provider, payTo: l.payTo,
      priceMicro: microUSDC(BigInt(l.priceMicro)), asset: l.asset, challenge: l.challenge,
    })),
    subtotalMicro: microUSDC(row.subtotalMicro),
    routingFeeMicro: microUSDC(row.routingFeeMicro),
    totalMicro: microUSDC(row.totalMicro),
    expiresAt: row.expiresAt.toISOString(),
    policy: row.policyVerdict as never,
    signature: row.signature,
  };
  if (!verifyQuoteSignature(reconstructed, cfg.QUOTE_SIGNING_KEY)) {
    throw new AxisError("SIGNATURE_INVALID", `quote ${quoteId} failed signature check`);
  }

  const chainLegs: Leg[] = stored.map((l) => ({
    stepId: l.stepId, provider: l.provider, payTo: l.payTo, priceMicro: microUSDC(BigInt(l.priceMicro)),
  }));
  const usdcAsaId = BigInt(cfg.USDC_ASA_ID);

  // Open the run row now so a crash mid-settle is recoverable.
  const runRow = { id: runId, quoteId, workflow: row.workflow, agentAddress: row.agentAddress,
    totalMicro: row.totalMicro, status: "PENDING" as const,
    ...(projectId ? { projectId } : {}), ...(apiKey ? { apiKey } : {}) };
  // Serialize reservations for this payer across all router processes. Network
  // calls happen after commit, so the lock is never held while settling.
  await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${payerAddress}))`);
    if (projectId) {
      const project = (await tx.select().from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.apiKey, apiKey))).for("update"))[0];
      if (!project) throw new AxisError("INVALID_INPUT", "no such project");
      if (project.budgetMicro != null) {
        const totals = await tx.select({ spent: sql<string>`coalesce(sum(${runs.totalMicro}), 0)` })
          .from(runs).where(and(eq(runs.projectId, projectId), ne(runs.status, "FAILED")));
        if (BigInt(totals[0]?.spent ?? "0") + row.totalMicro > project.budgetMicro) {
          throw new AxisError("POLICY_VIOLATION", "project budget exceeded");
        }
      }
    }
    const currentPolicy = await evaluatePolicy(payerAddress, reconstructed.legs, row.totalMicro, undefined, cfg, runId, tx);
    if (currentPolicy.verdict === "FAIL") throw new AxisError("POLICY_VIOLATION", currentPolicy.violations.join("; "));
    const claimed = await tx.update(quotes).set({ status: "CONSUMED" })
      .where(and(eq(quotes.id, quoteId), eq(quotes.status, "OPEN"), sql`${quotes.expiresAt} > now()`))
      .returning({ id: quotes.id });
    if (!claimed.length) throw new AxisError("QUOTE_CONSUMED", "quote consumed or expired");
    await tx.insert(runs).values(runRow);
    // Reserve before releasing the lock. These become settled spend, or are
    // released only when we know submission never started.
    await tx.insert(spendEvents).values(chainLegs.map((leg, i) => ({
      id: `${runId}:${leg.stepId}`, agentAddress: payerAddress, runId,
      provider: leg.provider, amountMicro: leg.priceMicro + (i === 0 ? row.routingFeeMicro : 0n),
    })));
  });

  const { algo, agent } = agentAccount(cfg);

  let submissionStarted = false;
  try {
    // ── 5. Pre-flight: opt-in + balance. Still free. ─────────────────────
    await preflight(algo, String(agent.addr), chainLegs, usdcAsaId, row.subtotalMicro);

    // ── 6. Compose ONE group, N payees ───────────────────────────────────
    const group = composeGroup(algo, { addr: agent.addr, signer: agent.signer }, chainLegs, usdcAsaId);
    emit(runId, {
      type: "group.composed", step: "compose",
      slots: chainLegs.map((l, i) => ({ index: i, kind: "payment" as const, stepId: l.stepId, payTo: l.payTo, amountUSDC: formatUSDC(l.priceMicro) })),
      groupSize: chainLegs.length, maxGroupSize: MAX_GROUP_SIZE,
    });

    const built = await group.build();

    // ── 7. Simulate — HARD GATE. Failure means nothing submits. ──────────
    const simStart = Date.now();
    await simulate(group);
    emit(runId, { type: "group.simulated", step: "simulate", passed: true, durationMs: Date.now() - simStart });

    // ── 8. One signature (the agent signs its N legs as one group). ──────
    emit(runId, { type: "group.signed", step: "sign", signatureCount: 1, legCount: chainLegs.length });

    // ── 9. Settle. All-or-nothing on chain, with automatic retry. ─────────
    // Persist transaction identities BEFORE submission, including the case
    // where the node accepted payment but its response was lost.
    await database.insert(legsTable).values(chainLegs.map((l, i) => ({
      id: `${runId}:${l.stepId}`, runId, stepId: l.stepId, provider: l.provider,
      payTo: l.payTo, priceMicro: l.priceMicro, groupIndex: i,
      txid: built.transactions[i].txn.txId(), status: "SUBMITTING",
    })));
    await database.update(runs).set({ status: "RECOVERY_REQUIRED" }).where(eq(runs.id, runId));
    submissionStarted = true;
    const settleStart = Date.now();
    const result = await settleWithRetry(group, (attempt, maxAttempts, message) => {
      emit(runId, { type: "settle.retry", step: "settle", attempt, maxAttempts, message: message.split("\n")[0] });
    });
    const txids = result.txids.map((txid, i) => ({
      stepId: chainLegs[i]!.stepId, provider: chainLegs[i]!.provider, payTo: chainLegs[i]!.payTo,
      txid, amountUSDC: formatUSDC(chainLegs[i]!.priceMicro), explorerUrl: explorer(txid),
    }));
    emit(runId, {
      type: "group.settled", step: "settle", groupId: result.groupId,
      confirmedRound: result.confirmedRound, durationMs: Date.now() - settleStart, txids,
    });

    // ── 10. Persist run + legs ───────────────────────────────────────────
    await database.update(runs).set({
      groupId: result.groupId, status: "PENDING", confirmedRound: BigInt(result.confirmedRound),
    }).where(eq(runs.id, runId));
    await database.update(legsTable).set({ status: "PAID" }).where(eq(legsTable.runId, runId));

    // ── 11. Phase 5: paid retries, compensation, receipt ─────────────────
    const settled = { runId, groupId: result.groupId, confirmedRound: result.confirmedRound, txids };
    const final = await runWorkflow(settled, cfg, (row.inputs ?? {}) as Record<string, unknown>, chaosStep);
    return { ...settled, status: final.status, refundedUSDC: formatUSDC(final.refundedMicro) };
  } catch (e) {
    const err = submissionStarted
      ? new AxisError("PAYMENT_RECOVERY_REQUIRED", "payment may have settled; reconciliation is required", { cause: (e as Error).message, runId })
      : e instanceof AxisError ? e : new AxisError("INTERNAL", (e as Error).message);
    await database.transaction(async (tx) => {
      await tx.update(runs).set({ status: submissionStarted ? "RECOVERY_REQUIRED" : "FAILED",
        error: err.toJSON().error, finishedAt: submissionStarted ? null : new Date() }).where(eq(runs.id, runId));
      if (!submissionStarted) await tx.delete(spendEvents).where(eq(spendEvents.runId, runId));
    });
    emit(runId, { type: "run.error", code: err.code, message: err.message, costedNothing: err.costedNothing });
    throw err;
  }
}
