/**
 * Runnable example for @axis/pay.
 *
 *   node example.ts            # quote only — ZERO payment
 *   PAY=1 node example.ts      # quote + settle a REAL atomic payment on testnet
 *
 * Env: ROUTER_URL (default http://localhost:8080), AGENT_ADDRESS.
 */
import { createAxisClient, AxisPayError } from "./src/index.ts";

const routerUrl = process.env.ROUTER_URL ?? "http://localhost:8080";
const agentAddress = process.env.AGENT_ADDRESS ?? "NG5SZZ3U6XOB4L5N4CPZ7SLIZRDIEK2CM4XMB5WDPLAWSCIRCIJTTKYOPQ";

const axis = createAxisClient({ routerUrl });

const inputs = {
  diff: "- const timeout = 10\n+ const timeout = 60",
  commitMessage: "bump request timeout to 60s",
};

try {
  console.log("→ quoting pr-review (no payment)…");
  const q = await axis.quote("pr-review", inputs, agentAddress);
  console.log(`  quote ${q.quoteId} · total $${q.totalUSDC} · policy ${q.policy.verdict}`);
  for (const l of q.legs) console.log(`    ${l.provider.padEnd(20)} $${l.priceUSDC}`);

  if (process.env.PAY === "1") {
    console.log("\n→ paying (real atomic settlement on testnet)…");
    const receipt = await axis.pay("pr-review", inputs, agentAddress, { budgetUSDC: 1 });
    console.log(`  ${receipt.status} · $${receipt.totalUSDC} · group ${receipt.groupId.slice(0, 12)}… · round ${receipt.confirmedRound}`);
    for (const l of receipt.legs) console.log(`    ${l.provider.padEnd(20)} ${l.status.padEnd(10)} ${l.explorerUrl}`);
  } else {
    console.log("\n(set PAY=1 to settle a real payment)");
  }
} catch (e) {
  if (e instanceof AxisPayError) console.error(`✖ ${e.code}: ${e.message} (costedNothing=${e.costedNothing})`);
  else console.error("✖", e);
  process.exit(1);
}
