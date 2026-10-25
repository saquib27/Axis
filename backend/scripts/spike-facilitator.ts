/**
 * Spike: build a MULTI-PAYEE group with the facilitator's feePayer covering
 * fees, and test /verify (safe, no settle). If the facilitator accepts it, the
 * agent needs only USDC — no ALGO. Replicates @x402/avm's client construction
 * (chunk-FXYJOXH6) but for N legs in one group.
 */
import { config as loadEnv } from "dotenv";
import { AlgorandClient } from "@algorandfoundation/algokit-utils/algorand-client";
import { Transaction, encodeTransactionRaw, groupTransactions } from "@algorandfoundation/algokit-utils/transact";
// The avm client encodes each group element as plain base64 of the txn bytes
// (signed SignedTxn msgpack for agent legs, raw unsigned msgpack for fee-payer).
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
import { microAlgo } from "@algorandfoundation/algokit-utils/amount";
import { USDC_TESTNET_ASA_ID, ALGORAND_TESTNET_GENESIS_HASH } from "@x402/avm";
const FULL_CAIP2 = `algorand:${ALGORAND_TESTNET_GENESIS_HASH}`;

loadEnv({ path: ".env.accounts", quiet: true });

const FACILITATOR = "https://facilitator.goplausible.xyz";
const USDC = BigInt(USDC_TESTNET_ASA_ID);

const legs = [
  { key: "DIFF", price: 30_000n },
  { key: "GUARDRAIL", price: 20_000n },
];

const algo = AlgorandClient.testNet();
const agent = algo.account.fromMnemonic(process.env.AGENT_MNEMONIC!);
algo.setSignerFromAccount(agent);

// feePayer for testnet, from /supported
const supported = await (await fetch(`${FACILITATOR}/supported`)).json() as { kinds: { network: string; extra?: { feePayer?: string } }[] };
const feePayer = supported.kinds.find((k) => k.network.includes("SGO1GK"))?.extra?.feePayer;
if (!feePayer) throw new Error("no testnet feePayer advertised");
console.log("feePayer:", feePayer);

// 1. Compose: fee-payer payment (index 0) + N asset transfers (agent, staticFee 0)
let composer = algo.newGroup();
composer = composer.addPayment({ sender: feePayer, receiver: feePayer, amount: microAlgo(0), note: `x402-fee-payer-${Date.now()}`, signer: agent.signer });
for (const l of legs) {
  composer = composer.addAssetTransfer({
    sender: agent.addr, receiver: process.env[`PAY_TO_${l.key}`]!, assetId: USDC,
    amount: l.price, staticFee: microAlgo(0n), note: `x402-payment-${l.key}`, signer: agent.signer,
  });
}
const built = await composer.build();
let txns: Transaction[] = built.transactions.map((t) => t.txn);

// 2. Re-fee: fee-payer (index 0) covers the whole group's pooled fee.
const sp = await algo.getSuggestedParams();
const feePerByte = Number(sp.fee), minFee = Number(sp.minFee);
let total = 0n;
for (const t of txns) { const size = encodeTransactionRaw(t).length; total += BigInt(feePerByte > 0 ? Math.max(feePerByte * size, minFee) : minFee); }
const ungrouped = txns.map((t, i) => new Transaction({ ...t, fee: i === 0 ? total : 0n, group: undefined }));
txns = groupTransactions(ungrouped);

// 3. Agent signs its legs (indexes 1..N); fee-payer (0) stays unsigned.
// The algokit signer takes Transaction[] + indexes and returns signed bytes.
const agentIdx = txns.map((t, i) => t.sender.toString() === agent.addr.toString() ? i : -1).filter((i) => i >= 0);
const signed = await agent.signer(txns, agentIdx);
const paymentGroup = txns.map((t, i) => {
  const pos = agentIdx.indexOf(i);
  // agent legs: signed SignedTxn bytes; fee-payer (index 0): unsigned raw bytes.
  return b64(pos >= 0 ? signed[pos]! : encodeTransactionRaw(t));
});
console.log("group size:", paymentGroup.length, "· paymentIndex will be 1");

// 4. /verify leg 1 (the first provider). The facilitator checks only this leg.
// x402Version 2: the facilitator parses requirements with the V2 schema, which
// uses `amount` (not the V1 `maxAmountRequired`) and BigInt()s it — the missing
// field was the "Cannot convert undefined to a BigInt" 500.
const paymentRequirements = {
  scheme: "exact", network: FULL_CAIP2,
  amount: legs[0].price.toString(), asset: USDC_TESTNET_ASA_ID,
  payTo: process.env[`PAY_TO_${legs[0].key}`], maxTimeoutSeconds: 60,
  extra: { feePayer },
};
const body = {
  x402Version: 2,
  paymentPayload: { x402Version: 2, scheme: "exact", network: FULL_CAIP2, payload: { paymentGroup, paymentIndex: 1 } },
  paymentRequirements,
};
const res = await fetch(`${FACILITATOR}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
console.log("\n/verify →", res.status);
console.log(JSON.stringify(await res.json(), null, 2).slice(0, 600));

// 5. /settle — REAL submission. The facilitator co-signs the fee-payer txn
// (index 0) and submits the whole group, so the agent pays ZERO ALGO fees.
// Gated behind SETTLE=1 because it moves real testnet USDC.
if (process.env.SETTLE === "1") {
  const settleRes = await fetch(`${FACILITATOR}/settle`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  console.log("\n/settle →", settleRes.status);
  const settled = await settleRes.json() as { transaction?: string };
  console.log(JSON.stringify(settled, null, 2).slice(0, 700));
  if (settled.transaction) {
    console.log("\nexplorer:", `https://lora.algokit.io/testnet/transaction/${settled.transaction}`);
  }
}
