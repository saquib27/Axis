# @axis/agent — autonomous budgeted agent

Give it a **goal** and a **USDC budget**. It picks one of the **9 services** that
genuinely fits the goal, fills its inputs with an LLM (NVIDIA NIM), quotes it, and
pays **atomically** — but only within budget. If **no** service can do the job
(e.g. "create an image"), it **refuses and pays nothing**. The budget is enforced
twice: the agent declines a quote over budget, and the router's Spend Policy Guard
is the hard backstop (a FAIL means nothing is ever signed). So even a misbehaving
agent can't overspend or pay for a task it can't deliver.

```bash
# needs the router running + NVIDIA_API_KEY in ../../.env
node src/cli.ts "Review this PR: - const t=10 / + const t=60" 1.00   # pays, settles
node src/cli.ts "Review this PR: ..." 0.05                           # declines: over budget
```

Example run:

```
🤖 goal: Review this PR: ...
💰 budget: $1.00
🧠 chose workflow "deep-review" with inputs: diff, commitMessage
🧾 quote: $0.31  ·  spend policy: PASS
✅ within budget — paying atomically…
💸 SETTLED — $0.30 across 9 providers (round 66110504)
📝 <LLM summary of all nine providers' results>
```

Built on [`@axis/pay`](../sdk). Zero extra dependencies — env is loaded with
node's built-in `process.loadEnvFile`.
