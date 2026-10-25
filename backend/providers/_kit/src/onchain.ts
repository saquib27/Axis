/**
 * On-chain payment verification, for the aggregator settle model.
 *
 * In AXIS the router settles ONE atomic group covering every provider up front,
 * then does paid retries. So by the time a provider is called with proof, its
 * payment is already committed — re-running the facilitator's verify (which
 * simulates) would fail on an already-settled group.
 *
 * Instead the provider verifies the SETTLED payment directly against the
 * Algorand indexer: does this txid exist, is it an ASA transfer of at least the
 * price to MY payout address, in the right asset? That is a real on-chain check,
 * not a trust-the-caller shortcut.
 */
const INDEXER = "https://testnet-idx.algonode.cloud";

export interface OnChainProof {
  txid: string;
  groupId?: string;
}

export function isOnChainProof(p: unknown): p is OnChainProof {
  return !!p && typeof p === "object" && typeof (p as Record<string, unknown>).txid === "string";
}

export async function verifyOnChain(
  txid: string,
  expect: { payTo: string; minAmount: bigint; asset: string },
): Promise<{ ok: boolean; error?: string }> {
  let res: Response;
  try {
    res = await fetch(`${INDEXER}/v2/transactions/${txid}`, { signal: AbortSignal.timeout(8000) });
  } catch (e) {
    return { ok: false, error: `indexer unreachable: ${(e as Error).message}` };
  }
  if (res.status === 404) return { ok: false, error: "payment txid not found on chain" };
  if (!res.ok) return { ok: false, error: `indexer ${res.status}` };

  const body = (await res.json()) as {
    transaction?: {
      "tx-type"?: string;
      "asset-transfer-transaction"?: { receiver?: string; amount?: number; "asset-id"?: number };
      "confirmed-round"?: number;
    };
  };
  const txn = body.transaction;
  const axfer = txn?.["asset-transfer-transaction"];
  if (txn?.["tx-type"] !== "axfer" || !axfer) {
    return { ok: false, error: "txid is not an asset transfer" };
  }
  if (axfer.receiver !== expect.payTo) {
    return { ok: false, error: `payment went to ${axfer.receiver}, not ${expect.payTo}` };
  }
  if (String(axfer["asset-id"]) !== expect.asset) {
    return { ok: false, error: `wrong asset ${axfer["asset-id"]}` };
  }
  if (BigInt(axfer.amount ?? 0) < expect.minAmount) {
    return { ok: false, error: `paid ${axfer.amount}, need ${expect.minAmount}` };
  }
  if (!txn["confirmed-round"]) {
    return { ok: false, error: "payment not yet confirmed" };
  }
  return { ok: true };
}
