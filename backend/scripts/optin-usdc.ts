/**
 * Phase 0 · step 3 — opt every provider payee into the USDC ASA.
 *
 * On Algorand an account must opt in to an asset before it can receive it.
 * A transfer to a non-opted-in address fails, and because our payments live in an
 * atomic group, ONE un-opted payee kills the ENTIRE workflow. This is the single
 * most common cause of a mystifying group failure.
 *
 * Opt-in requires ~0.1 ALGO of minimum balance per asset, so the agent funds each
 * payee with a small ALGO float first.
 */
import { microAlgo } from "@algorandfoundation/algokit-utils/amount";
import { algorand, PROVIDERS, USDC_ASA_ID, requireEnv, explorerTx, hr } from "./_shared.ts";

const algo = algorand();
const agent = algo.account.fromMnemonic(requireEnv("AGENT_MNEMONIC"));
algo.setSignerFromAccount(agent);

/** enough for the 0.1 ALGO asset MBR + a few txn fees */
const FLOAT_MICROALGO = 300_000n;

/** Has this address already opted into USDC? */
async function isOptedIn(address: string): Promise<boolean> {
  try {
    const info = await algo.account.getInformation(address);
    return info.assets?.some((a) => BigInt(a.assetId) === USDC_ASA_ID) ?? false;
  } catch {
    return false; // account not on chain yet
  }
}

hr(`Opting into USDC ASA ${USDC_ASA_ID}`);

// ── The AGENT must opt in too, and FIRST. ──────────────────────────────────
// On Algorand an account cannot RECEIVE an asset it has not opted into, so the
// Circle faucet silently has nowhere to send USDC until this runs. Opting the
// payees in but not the payer is the easiest way to lose an hour to a faucet
// that "isn't working".
process.stdout.write(`${"agent (payer)".padEnd(18)}`);
if (await isOptedIn(String(agent.addr))) {
  console.log("already opted in — skipped");
} else {
  const r = await algo
    .newGroup()
    .addAssetOptIn({ sender: agent.addr, assetId: USDC_ASA_ID, signer: agent.signer })
    .send();
  const txid = r.txIds[0];
  console.log(`opted in  ${txid}`);
  console.log(`${" ".repeat(18)}${explorerTx(txid)}`);
}

for (const p of PROVIDERS) {
  const address = requireEnv(`PAY_TO_${p.key}`);
  const mnemonic = requireEnv(`PAY_TO_${p.key}_MNEMONIC`);
  const payee = algo.account.fromMnemonic(mnemonic);

  process.stdout.write(`${p.name.padEnd(18)}`);

  // Safe to re-run.
  if (await isOptedIn(address)) {
    console.log("already opted in — skipped");
    continue;
  }

  // Fund the float and opt in, in one atomic group.
  const result = await algo
    .newGroup()
    .addPayment({
      sender: agent.addr,
      receiver: address,
      amount: microAlgo(FLOAT_MICROALGO),
      signer: agent.signer,
      staticFee: microAlgo(2000n),  // pays for BOTH txns in this group
    })
    .addAssetOptIn({
      sender: address,
      assetId: USDC_ASA_ID,
      signer: payee.signer,
      staticFee: microAlgo(0n),   // fee pooled from the agent's payment above
    })
    .send();

  const txid = result.txIds[result.txIds.length - 1];
  console.log(`opted in  ${txid}`);
  console.log(`${" ".repeat(18)}${explorerTx(txid)}`);
}

hr();
console.log("✔ Opt-in pass complete. Verify with:  pnpm accounts:check\n");
