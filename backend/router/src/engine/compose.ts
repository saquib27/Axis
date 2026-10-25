/**
 * Compose the atomic group. Phase 4 — the core.
 *
 * ONE group, N USDC payment legs to N DISTINCT payees, built from the quote.
 * This is the thing the whole submission rests on: atomicity is a property of
 * the Algorand chain, not of our code. Either all N legs commit or none do.
 *
 * The 16-transaction group cap is enforced (one slot reserved for fees), and a
 * pre-flight check confirms every payee is opted into USDC — the #1 silent
 * failure, and one that would otherwise fail the ENTIRE group.
 */
import { AlgorandClient } from "@algorandfoundation/algokit-utils/algorand-client";
import { AxisError, MAX_PROVIDER_LEGS, type MicroUSDC } from "@axis/shared";
import type { Config } from "../config.ts";

export interface Leg {
  stepId: string;
  provider: string;
  payTo: string;
  priceMicro: MicroUSDC;
}

/** Confirm every payee is opted into USDC before composing — fail cheap. */
export async function preflight(
  algo: AlgorandClient,
  agentAddr: string,
  legs: Leg[],
  usdcAsaId: bigint,
  totalMicro: bigint,
): Promise<void> {
  const notOpted: string[] = [];
  for (const leg of legs) {
    const info = await algo.account.getInformation(leg.payTo);
    if (!info.assets?.some((a) => BigInt(a.assetId) === usdcAsaId)) {
      notOpted.push(`${leg.provider} (${leg.payTo.slice(0, 8)}…)`);
    }
  }
  if (notOpted.length) {
    throw new AxisError("NOT_OPTED_IN",
      `payee(s) not opted into USDC: ${notOpted.join(", ")}`, { notOpted });
  }

  const agent = await algo.account.getInformation(agentAddr);
  const usdc = agent.assets?.find((a) => BigInt(a.assetId) === usdcAsaId);
  const bal = usdc ? BigInt(usdc.amount) : 0n;
  if (bal < totalMicro) {
    throw new AxisError("INSUFFICIENT_BALANCE",
      `agent holds ${bal}µ USDC, needs ${totalMicro}µ`, { balance: bal.toString(), needed: totalMicro.toString() });
  }
}

export interface AgentAccount {
  addr: { toString(): string } | string;
  signer: unknown;
}

/** Build the group. Returns the algokit composer, ready to simulate or send. */
export function composeGroup(
  algo: AlgorandClient,
  agent: AgentAccount,
  legs: Leg[],
  usdcAsaId: bigint,
) {
  if (legs.length > MAX_PROVIDER_LEGS) {
    throw new AxisError("GROUP_TOO_LARGE",
      `${legs.length} legs exceeds ${MAX_PROVIDER_LEGS}`, { legs: legs.length });
  }
  let group = algo.newGroup();
  for (const leg of legs) {
    group = group.addAssetTransfer({
      sender: agent.addr as never,
      receiver: leg.payTo,
      assetId: usdcAsaId,
      amount: leg.priceMicro,
      signer: agent.signer as never,
    });
  }
  return group;
}
