const STEPS = [
  ["1 discover", "Router fans out unpaid probes to all providers — no money moves."],
  ["2 challenge", "Each provider replies 402 with its price. The router reads the price from here."],
  ["3 quote", "DAG resolved into parallel batches, costs summed, quote signed with a TTL."],
  ["4 policy", "The spend guard evaluates ceilings, velocity, trust. A FAIL blocks everything at zero cost."],
  ["5 compose", "One atomic group is built — N USDC legs to N distinct payees."],
  ["6 simulate", "A free dry run. A group that fails simulation is never submitted."],
  ["7 sign", "One signature from the agent authorizes the whole workflow."],
  ["8 settle", "The group commits all-or-nothing in ~3s. Every txid is returned, then providers deliver."],
];
export default function Protocol() {
  return (
    <main>
      <h1>How it works</h1>
      <p>The full x402 flow, run N times per workflow, plus a distinct quote phase that reads prices without paying.</p>
      <ol>
        {STEPS.map(([s, d]) => <li key={s}><strong>{s}</strong> — {d}</li>)}
      </ol>
      <h3>Why Algorand</h3>
      <p>Atomic transaction groups (up to 16, all-or-nothing, no smart contract), ~3s deterministic finality, simulateTransactions for a free pre-flight, and fee pooling so the agent needs only USDC. On an EVM chain this means writing an escrow contract.</p>
    </main>
  );
}
