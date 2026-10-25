/**
 * ══ PHASE 0 GATE ══
 *
 * The entire AXIS architecture rests on ONE assumption:
 *
 *   A single Algorand atomic transaction group can carry N USDC payment legs to
 *   N DIFFERENT payees, be validated by simulateTransactions before anything moves,
 *   and then commit all-or-nothing.
 *
 * This script proves it, or kills the design tonight instead of on submission day.
 *
 *   pnpm spike            build → simulate → submit → confirm
 *   pnpm spike --dry      build → simulate only (no money moves)
 *   pnpm spike --fail     inject an over-spend leg; simulation MUST reject it
 *
 * See docs/PROTOCOL.md §3 for why paymentIndex being singular does not block this.
 */
import {
  algorand, PROVIDERS, USDC_ASA_ID, toMicro, fromMicro,
  requireEnv, explorerTx, hr,
} from "./_shared.ts";

const DRY = process.argv.includes("--dry");
const FAIL = process.argv.includes("--fail");

const algo = algorand();
const agent = algo.account.fromMnemonic(requireEnv("AGENT_MNEMONIC"));
algo.setSignerFromAccount(agent);

const legs = PROVIDERS.map((p) => ({
  name: p.name,
  payTo: requireEnv(`PAY_TO_${p.key}`),
  micro: toMicro(p.priceUSDC),
}));

if (FAIL) {
  // 1000 USDC — far beyond the agent's balance. Simulation must catch this
  // BEFORE submission, proving the pre-flight gate is real.
  legs[1] = { ...legs[1], micro: toMicro("1000.00") };
}

const total = legs.reduce((a, l) => a + l.micro, 0n);

hr("AXIS PHASE 0 — multi-payee atomic group");
console.log(`network   algorand testnet`);
console.log(`asset     USDC ASA ${USDC_ASA_ID}`);
console.log(`agent     ${agent.addr}`);
console.log(`mode      ${FAIL ? "FAIL-INJECTION (expect simulation to reject)" : DRY ? "DRY RUN" : "LIVE"}`);
console.log(`\nlegs      ${legs.length} payees, ${legs.length} distinct addresses`);
for (const l of legs) {
  console.log(`  ${l.name.padEnd(18)} ${fromMicro(l.micro).padStart(11)} USDC → ${l.payTo.slice(0, 12)}…`);
}
console.log(`  ${"TOTAL".padEnd(18)} ${fromMicro(total).padStart(11)} USDC`);

// ── Assert the group budget. Facilitator caps groups at 16; one slot is reserved
//    for the fee payer, so AXIS allows at most 15 provider legs. (PROTOCOL.md §4)
const MAX_PROVIDER_LEGS = 15;
if (legs.length > MAX_PROVIDER_LEGS) {
  console.error(`\n✖ GROUP_TOO_LARGE: ${legs.length} legs > ${MAX_PROVIDER_LEGS}\n`);
  process.exit(1);
}

// ── Compose ONE group, N legs, N distinct receivers ────────────────────────
let group = algo.newGroup();
for (const l of legs) {
  group = group.addAssetTransfer({
    sender: agent.addr,
    receiver: l.payTo,
    assetId: USDC_ASA_ID,
    amount: l.micro,
    signer: agent.signer,
  });
}

hr("STEP 1 — simulateTransactions (dry run, zero cost)");

let simOk = false;
try {
  const sim = await group.simulate({ skipSignatures: true });
  const failure = sim.simulateResponse?.txnGroups?.[0]?.failureMessage;
  if (failure) {
    console.log(`✖ simulation REJECTED the group`);
    console.log(`  reason: ${failure}`);
  } else {
    simOk = true;
    console.log(`✔ simulation PASSED — ${group.count()} transactions validated`);
    console.log(`  balances, opt-ins, fees and group integrity all check out`);
  }
} catch (err) {
  console.log(`✖ simulation REJECTED the group`);
  console.log(`  reason: ${(err as Error).message.split("\n")[0]}`);
}

if (FAIL) {
  hr();
  if (simOk) {
    console.error("✖ GATE FAILED: an over-spend leg was NOT caught by simulation.");
    console.error("  The pre-flight gate does not work. Do not proceed.\n");
    process.exit(1);
  }
  console.log("✔ GATE PASSED: simulation caught the bad leg before submission.");
  console.log("  Nothing was submitted. Zero cost. This is the guarantee AXIS sells.\n");
  process.exit(0);
}

if (!simOk) {
  console.error("\n✖ Simulation failed on a group that should be valid.");
  console.error("  Run `pnpm accounts:check` — most likely a payee is not opted into USDC,");
  console.error("  or the agent is short on USDC/ALGO.\n");
  process.exit(1);
}

if (DRY) {
  hr();
  console.log("Dry run complete — nothing submitted. Drop --dry to settle for real.\n");
  process.exit(0);
}

// ── Submit ────────────────────────────────────────────────────────────────
hr("STEP 2 — submit the atomic group");

const result = await group.send();
const txIds: string[] = result.txIds;
const confirmedRound = result.confirmations?.[0]?.confirmedRound;

console.log(`✔ committed in round ${confirmedRound}`);
console.log(`\ngroup id   ${result.groupId ?? "(see any txn below)"}`);
console.log(`txids      ${txIds.length} — one per payee, all in ONE group\n`);

txIds.forEach((id, i) => {
  console.log(`  ${legs[i].name.padEnd(18)} ${fromMicro(legs[i].micro)} USDC`);
  console.log(`  ${" ".repeat(18)} ${explorerTx(id)}`);
});

hr("PHASE 0 GATE — PASSED");
console.log(`
One group. ${txIds.length} payment legs. ${txIds.length} distinct payees. One signature set.
All-or-nothing, enforced by the chain — no escrow contract, no smart contract.

This is the AXIS thesis, proven on testnet. Proceed to Phase 1.
`);
