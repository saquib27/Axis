/**
 * Mint DISTINCT payout accounts for the toolbox services, so a workflow that
 * uses them creates a genuinely multi-payee atomic group (more payees, not
 * repeats). Each new account is funded with a small ALGO float and opted into
 * USDC in one atomic group — the same pattern as optin-usdc.ts.
 *
 * Prints PAY_TO_TOOL_* lines to append to .env.accounts (gitignored).
 */
import { randomBytes } from "node:crypto";
import { mnemonicFromSeed } from "@algorandfoundation/algokit-utils/algo25";
import { AlgorandClient } from "@algorandfoundation/algokit-utils/algorand-client";
import { microAlgo } from "@algorandfoundation/algokit-utils/amount";
import { config as loadEnv } from "dotenv";

loadEnv({ path: "../../.env.accounts", quiet: true });
loadEnv({ path: "../../.env", quiet: true });

const algo = AlgorandClient.testNet();
const agent = algo.account.fromMnemonic(process.env.AGENT_MNEMONIC!);
algo.setSignerFromAccount(agent);
const USDC = BigInt(process.env.USDC_ASA_ID ?? "10458941");

const SERVICES = ["CODE", "DEBUG", "TEST", "TRANSLATE", "SUMMARIZE"];
const lines: string[] = [];

for (const s of SERVICES) {
  const mnemonic = mnemonicFromSeed(new Uint8Array(randomBytes(32)));
  const payee = algo.account.fromMnemonic(mnemonic);
  const address = String(payee.addr);

  process.stdout.write(`PAY_TO_TOOL_${s.padEnd(10)} ${address.slice(0, 10)}… `);
  await algo.newGroup()
    .addPayment({ sender: agent.addr, receiver: address, amount: microAlgo(300_000n), signer: agent.signer, staticFee: microAlgo(2000n) })
    .addAssetOptIn({ sender: payee.addr, assetId: USDC, signer: payee.signer, staticFee: microAlgo(0n) })
    .send();
  console.log("funded + opted into USDC ✓");

  lines.push(`PAY_TO_TOOL_${s}=${address}`);
  lines.push(`PAY_TO_TOOL_${s}_MNEMONIC=${mnemonic}`);
}

console.log("\n──────── append these to .env.accounts ────────\n");
console.log(lines.join("\n"));
