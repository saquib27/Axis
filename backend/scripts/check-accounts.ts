/**
 * Phase 0 · step 2 — verify funding and USDC opt-in status for all five accounts.
 *
 * "Payee not opted into the USDC ASA" is the #1 silent failure in this whole build:
 * a transfer to a non-opted-in address fails the ENTIRE atomic group. Check first.
 */
import {
  algorand, PROVIDERS, USDC_ASA_ID, fromMicro, requireEnv, explorerAcct, hr,
} from "./_shared.ts";

const algo = algorand();

async function inspect(label: string, address: string) {
  const info = await algo.account.getInformation(address);
  const algos = info.balance.microAlgo;
  const usdcAsset = info.assets?.find((a) => BigInt(a.assetId) === USDC_ASA_ID);
  const optedIn = usdcAsset !== undefined;
  const usdc = optedIn ? BigInt(usdcAsset.amount) : 0n;

  return { label, address, algos, optedIn, usdc };
}

const targets = [
  { label: "agent", address: requireEnv("AGENT_ADDRESS") },
  ...PROVIDERS.map((p) => ({
    label: p.name,
    address: requireEnv(`PAY_TO_${p.key}`),
  })),
];

hr(`USDC ASA ${USDC_ASA_ID} · Algorand testnet`);
console.log(
  `${"account".padEnd(17)}${"ALGO".padStart(12)}${"USDC".padStart(14)}   opted-in`,
);
console.log("─".repeat(72));

const rows = [];
for (const t of targets) {
  try {
    const r = await inspect(t.label, t.address);
    rows.push(r);
    const algoStr = (Number(r.algos) / 1e6).toFixed(6);
    console.log(
      `${r.label.padEnd(17)}${algoStr.padStart(12)}${fromMicro(r.usdc).padStart(14)}   ${
        r.optedIn ? "yes" : "NO  ←"
      }`,
    );
  } catch {
    console.log(`${t.label.padEnd(17)}${"—".padStart(12)}${"—".padStart(14)}   not funded ←`);
    rows.push({ label: t.label, address: t.address, algos: 0n, optedIn: false, usdc: 0n });
  }
}

const agent = rows[0];
const payees = rows.slice(1);
const problems: string[] = [];

if (agent.algos < 200_000n) problems.push("Agent has < 0.2 ALGO — fund it at https://lora.algokit.io/testnet/fund");
if (!agent.optedIn) problems.push("Agent is not opted into USDC — get testnet USDC at https://faucet.circle.com (USDC → Algorand Testnet)");
else if (agent.usdc < 200_000n) problems.push(`Agent holds only ${fromMicro(agent.usdc)} USDC — need ≥ 0.20 for the spike`);

const notOpted = payees.filter((p) => !p.optedIn);
if (notOpted.length) problems.push(`${notOpted.length} payee(s) not opted into USDC — run: pnpm accounts:optin`);

hr();
if (problems.length === 0) {
  console.log("✔ All five accounts ready. Next:  pnpm spike\n");
} else {
  console.log("Blocking issues:\n");
  problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
  console.log(`\nAgent: ${explorerAcct(agent.address)}\n`);
  process.exitCode = 1;
}
