/**
 * Phase 5 — execute the paid provider calls, compensate failures, emit receipt.
 *
 * After the atomic group settles (Phase 4), each provider is called WITH its
 * settled-txid proof, in DAG batch order (so bugsum receives diff's output).
 * A provider that took payment and fails to deliver gets its leg REVERSED on
 * chain — money genuinely goes backwards — and the run is marked PARTIAL.
 *
 * This is the difference between "the payment worked" and "the service was
 * delivered", which is the one thing most x402 submissions will miss.
 */
import { eq } from "drizzle-orm";
import {
  AxisError, formatUSDC, interpolate, microUSDC, type MicroUSDC,
} from "@axis/shared";
import type { Config } from "../config.ts";
import { db } from "../db/client.ts";
import { runs, legs as legsTable } from "../db/schema.ts";
import { WORKFLOWS } from "../workflows/pr-review.ts";
import { agentAccount } from "../chain/client.ts";
import { emit } from "../bus.ts";
import type { ExecuteResult } from "./execute.ts";

const explorer = (t: string) => `https://lora.algokit.io/testnet/transaction/${t}`;

interface Delivered { stepId: string; output: unknown; }

/** Call one provider with proof; return its result or throw (paid-but-failed). */
async function callProvider(
  base: string, path: string, txid: string, input: Record<string, unknown>,
): Promise<unknown> {
  const proof = btoa(JSON.stringify({ txid }));
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-PAYMENT": proof },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json()) as { result?: unknown; error?: { code: string; message: string } };
  if (!res.ok || body.error) {
    throw new AxisError("PROVIDER_FAILED", body.error?.message ?? `provider ${res.status}`, {
      provider: path, status: res.status,
    });
  }
  return body.result;
}

/** Reverse a settled leg: send the USDC back from the payee to the agent. */
async function compensate(
  cfg: Config, payeeMnemonicEnv: string, payTo: string, agentAddr: string,
  amount: MicroUSDC, usdcAsaId: bigint,
): Promise<string> {
  const { algo } = agentAccount(cfg);
  // We control the demo payee accounts, so we can execute a real reversal.
  // In production this is enforced by provider escrow or a facilitator capture.
  const mnemonic = process.env[payeeMnemonicEnv];
  if (!mnemonic) throw new AxisError("COMPENSATION_FAILED", `no key to refund ${payTo}`);
  const payee = algo.account.fromMnemonic(mnemonic);
  const r = await algo.newGroup()
    .addAssetTransfer({ sender: payee.addr as never, receiver: agentAddr, assetId: usdcAsaId, amount, signer: payee.signer as never })
    .send();
  return r.txIds[0]!;
}

const MNEMONIC_ENV: Record<string, string> = {
  "diff-explainer": "PAY_TO_DIFF_MNEMONIC",
  "guardrail-checker": "PAY_TO_GUARDRAIL_MNEMONIC",
  "commit-roaster": "PAY_TO_ROASTER_MNEMONIC",
  "bug-summarizer": "PAY_TO_BUGSUM_MNEMONIC",
  // Toolbox services — each a distinct payee, so each can be refunded on failure.
  "code-generator": "PAY_TO_TOOL_CODE_MNEMONIC",
  "debugger": "PAY_TO_TOOL_DEBUG_MNEMONIC",
  "test-writer": "PAY_TO_TOOL_TEST_MNEMONIC",
  "translator": "PAY_TO_TOOL_TRANSLATE_MNEMONIC",
  "summarizer": "PAY_TO_TOOL_SUMMARIZE_MNEMONIC",
};

/** After settle: run providers in DAG order, compensate failures, finalize. */
export async function runWorkflow(
  settled: ExecuteResult, cfg: Config, inputs: Record<string, unknown>,
  chaosStep?: string,
): Promise<{ status: "SETTLED" | "PARTIAL"; refundedMicro: MicroUSDC }> {
  const { runId } = settled;
  const database = db(cfg.DATABASE_URL);
  const run = (await database.select().from(runs).where(eq(runs.id, runId)))[0];
  const workflow = WORKFLOWS[run.workflow];
  if (!workflow) throw new AxisError("PROVIDER_FAILED", "unknown stored workflow");
  const { agent } = agentAccount(cfg);
  const usdcAsaId = BigInt(cfg.USDC_ASA_ID);

  const txByStep = new Map(settled.txids.map((t) => [t.stepId, t]));
  const outputs: Record<string, unknown> = {};
  const delivered: Delivered[] = [];
  let refundedMicro = microUSDC(0n);
  const dag = workflow.steps; // batches come from the resolved order

  // Rebuild batches from the workflow (same resolver the quote used).
  const { resolveDag } = await import("@axis/shared");
  const batches = resolveDag(workflow.steps).batches;

  for (const batch of batches) {
    // Steps in a batch run in parallel.
    await Promise.all(batch.map(async (stepId) => {
      const step = workflow.steps.find((s) => s.id === stepId)!;
      const tx = txByStep.get(stepId);
      if (!tx) return;

      // A step whose dependency failed is skipped and compensated.
      const depFailed = (resolveDag(workflow.steps).edges)
        .filter((e) => e.to === stepId)
        .some((e) => !delivered.find((d) => d.stepId === e.from));
      if (depFailed) {
        emit(runId, { type: "step.skipped", stepId, becauseStepId: "dependency" });
        const refundTxid = await compensate(cfg, MNEMONIC_ENV[step.provider]!, tx.payTo, String(agent.addr), microUSDC(BigInt(Math.round(Number(tx.amountUSDC) * 1e6))), usdcAsaId).catch(() => null);
        if (refundTxid) {
          refundedMicro = microUSDC(refundedMicro + BigInt(Math.round(Number(tx.amountUSDC) * 1e6)));
          emit(runId, { type: "node.state", stepId, state: "refunded" });
          emit(runId, { type: "compensation.issued", stepId, provider: step.provider, amountUSDC: tx.amountUSDC, txid: refundTxid, explorerUrl: explorer(refundTxid), reason: "dependency failed" });
          await database.update(legsTable).set({ status: "COMPENSATED", compensationTxid: refundTxid }).where(eq(legsTable.txid, tx.txid));
        }
        return;
      }

      emit(runId, { type: "step.started", stepId });
      emit(runId, { type: "node.state", stepId, state: "running" });
      const base = cfg[step.endpointEnv as keyof Config] as string;
      const input = interpolate(step.input, { inputs, outputs }) as Record<string, unknown>;
      const started = Date.now();

      try {
        // Demo affordance: force THIS step to fail AFTER payment, to exercise
        // the compensation path — a provider that took money and died.
        if (chaosStep === stepId) {
          throw new AxisError("PROVIDER_FAILED", "chaos: provider took payment and returned 502");
        }
        const output = await callProvider(base, step.path, tx.txid, input);
        outputs[stepId] = output;
        delivered.push({ stepId, output });
        emit(runId, { type: "step.delivered", stepId, latencyMs: Date.now() - started, preview: JSON.stringify(output).slice(0, 600) });
        emit(runId, { type: "node.state", stepId, state: "delivered" });
        await database.update(legsTable).set({ status: "DELIVERED", result: output as object, latencyMs: Date.now() - started }).where(eq(legsTable.txid, tx.txid));
      } catch (e) {
        // Paid but did not deliver → REVERSE the payment on chain.
        emit(runId, { type: "step.failed", stepId, code: "PROVIDER_FAILED", message: (e as Error).message });
        emit(runId, { type: "node.state", stepId, state: "compensating" });
        const amount = microUSDC(BigInt(Math.round(Number(tx.amountUSDC) * 1e6)));
        const refundTxid = await compensate(cfg, MNEMONIC_ENV[step.provider]!, tx.payTo, String(agent.addr), amount, usdcAsaId).catch(() => null);
        if (refundTxid) {
          refundedMicro = microUSDC(refundedMicro + amount);
          emit(runId, { type: "node.state", stepId, state: "refunded" });
          emit(runId, { type: "compensation.issued", stepId, provider: step.provider, amountUSDC: tx.amountUSDC, txid: refundTxid, explorerUrl: explorer(refundTxid), reason: "paid but did not deliver" });
          await database.update(legsTable).set({ status: "COMPENSATED", compensationTxid: refundTxid, error: { message: (e as Error).message } }).where(eq(legsTable.txid, tx.txid));
        } else {
          await database.update(legsTable).set({ status: "FAILED", error: { message: (e as Error).message } }).where(eq(legsTable.txid, tx.txid));
        }
      }
    }));
  }

  const status = delivered.length < workflow.steps.length ? "PARTIAL" : "SETTLED";
  await database.update(runs).set({ status, refundedMicro, finishedAt: new Date() }).where(eq(runs.id, runId));

  const totalPaid = settled.txids.reduce((a, t) => a + BigInt(Math.round(Number(t.amountUSDC) * 1e6)), 0n);
  emit(runId, {
    type: "run.completed", status, receiptId: runId,
    totalUSDC: formatUSDC(microUSDC(totalPaid)), refundedUSDC: formatUSDC(refundedMicro),
    durationMs: 0,
  });

  return { status, refundedMicro };
}
