/**
 * Phase 0 · step 1 — generate the five testnet accounts AXIS needs.
 *
 *   1 router agent  (pays)  +  4 provider payees (receive)
 *
 * Writes .env.accounts, which is gitignored. Mnemonics NEVER go in git.
 * Refuses to overwrite an existing file — delete it deliberately if you mean to.
 */
import { writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { mnemonicFromSeed } from "@algorandfoundation/algokit-utils/algo25";
import { algorand, PROVIDERS, explorerAcct, hr } from "./_shared.ts";

const OUT = ".env.accounts";

if (existsSync(OUT)) {
  console.error(`\n✖ ${OUT} already exists — refusing to overwrite.`);
  console.error(`  These accounts may already be funded and opted in.`);
  console.error(`  To regenerate: rm ${OUT}   (you will need to re-fund)\n`);
  process.exit(1);
}

const algo = algorand();

console.log("Generating 5 Algorand testnet accounts…");

/**
 * `account.random()` returns only a public key + signers — it never exposes the
 * secret, so there is no mnemonic to persist. Generate a 32-byte seed ourselves,
 * derive the 25-word mnemonic, and rehydrate the account from it.
 */
function newAccount() {
  const mnemonic = mnemonicFromSeed(new Uint8Array(randomBytes(32)));
  return { mnemonic, addr: String(algo.account.fromMnemonic(mnemonic).addr) };
}

const agent = newAccount();
const payees = PROVIDERS.map((p) => ({ ...p, acct: newAccount() }));

const lines = [
  "# AXIS testnet accounts — GENERATED, GITIGNORED, NEVER COMMIT",
  `# created: ${new Date().toISOString()}`,
  "",
  "# ── Router agent (holds USDC, signs every payment leg) ──",
  `AGENT_ADDRESS=${agent.addr}`,
  `AGENT_MNEMONIC=${agent.mnemonic}`,
  "",
  "# ── Provider payees (each a DISTINCT address — this is the whole point) ──",
];

for (const p of payees) {
  lines.push(
    `# ${p.name}  (${p.priceUSDC} USDC)`,
    `PAY_TO_${p.key}=${p.acct.addr}`,
    `PAY_TO_${p.key}_MNEMONIC=${p.acct.mnemonic}`,
    "",
  );
}

writeFileSync(OUT, lines.join("\n"));

hr("ACCOUNTS CREATED");
console.log(`agent          ${agent.addr}`);
for (const p of payees) console.log(`${p.name.padEnd(15)}${p.acct.addr}`);

hr("NEXT — fund the agent (this part is manual)");
console.log(`
1. Open   https://lora.algokit.io/testnet/fund
   Paste  ${agent.addr}
   Dispense ALGO.

2. Get testnet USDC for the SAME address:
   https://faucet.circle.com  →  USDC → network: Algorand Testnet

3. Then run:
     pnpm accounts:check     # confirms balances landed
     pnpm accounts:optin     # opts all 4 payees into USDC
     pnpm spike              # the Phase 0 gate

Agent on explorer: ${explorerAcct(agent.addr)}
`);
console.log(`Written to ${OUT} (gitignored).\n`);
