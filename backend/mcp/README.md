<img src="./logo.svg" alt="AXIS" width="72" align="right" />

# @axis/mcp — AXIS as MCP tools for Claude

An [MCP](https://modelcontextprotocol.io) server that gives **Claude** (Desktop,
Code, or any MCP client) the ability to **atomically pay N x402 APIs on
Algorand** and get a unified receipt back — natively, as tools it can call in a
normal conversation.

Ask Claude *"create an AXIS project called hello, then review this diff under
it"* and it will: create the project, price nine paid services, settle them in
one atomic Algorand group with one signature, and hand you back every result —
while your console and Chrome extension animate the whole thing live.

It is a thin wrapper (~180 lines) over the
[`axis-pay`](https://www.npmjs.com/package/axis-pay) npm package. The router
holds the wallet and does the signing — **this server never touches a key**.

> **New here? Read [`docs/USING_WITH_CLAUDE.md`](../../docs/USING_WITH_CLAUDE.md)**
> — the end-to-end guide: start the router, add your API key, watch it live,
> and a page of prompts to paste. This file is the server reference.

---

## The seven tools

| Tool | What Claude can do with it |
|---|---|
| `list_workflows` | see every workflow the router can run, its provider steps and required inputs |
| `quote_workflow` | price a workflow by reading each provider's live 402 — **zero payment** |
| `pay_and_run` | settle **one atomic group** for a named workflow and return every provider's result + receipt |
| `run_agent` | hand it a **plain-English task**; an LLM picks the workflow, or refuses if nothing fits |
| `get_run_result` | fetch a run's outcome by `runId` — status, spend, per-provider results |
| `list_projects` | projects with spend, refunds, and remaining budget |
| `create_project` | create a project, optionally with a `budgetUSDC` ceiling |

### `pay_and_run` vs `run_agent`

- **`pay_and_run`** needs the exact workflow id (call `list_workflows` first).
  Deterministic: you said `deep-review`, it runs `deep-review`.
- **`run_agent`** needs nothing but a goal in English. The router's own LLM
  decides whether an available service genuinely does that job — and **refuses,
  spending nothing**, when none does.

That refusal is the honesty gate, not a bug. Ask it to *"print hello world"* and
it correctly declines: no paid service does that, so no money moves.

Both also accept a **`filePath`** (absolute path to a local file whose contents
become the diff), so you can say *"review the file at /path/…"* instead of
pasting a diff into chat.

---

## Setup

### 1. Get your API key

AXIS console → **Projects** page → the key bar at the top → **copy**. It looks like
`axis_a59f26f4…`.

This is what makes a task you give Claude show up **live** in your own console
(Workflow page) and Chrome extension. Without it, calls run unscoped and nothing
ties back to your account.

### 2a. Claude Code

```bash
claude mcp add axis-pay \
  -e ROUTER_URL=http://localhost:8080 \
  -e AXIS_API_KEY=axis_yourkey \
  -- node /ABSOLUTE/PATH/AXIS/backend/mcp/src/index.ts
```

Add `-s user` to make it available in every project rather than just this repo.
Verify with `claude mcp list`.

### 2b. Claude Desktop

Add to `claude_desktop_config.json` — on macOS
`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "axis-pay": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/AXIS/backend/mcp/src/index.ts"],
      "env": {
        "ROUTER_URL": "http://localhost:8080",
        "AXIS_API_KEY": "axis_yourkey"
      }
    }
  }
}
```

Restart Claude Desktop. The tools appear under the 🔌 icon.

### 3. Make sure the router is up

```bash
cd backend/router && npm start     # → :8080
```

---

## Environment

| Variable | Default | What it does |
|---|---|---|
| `ROUTER_URL` | `http://localhost:8080` | which AXIS router to talk to |
| `AXIS_API_KEY` | *(unset)* | scopes every call to your account — runs appear live in your console + extension |
| `AGENT_ADDRESS` | the router's own wallet | Algorand address that pays |

---

## A real session

```
You:    Create an AXIS project called "hello" with a $1 budget.
Claude: [create_project] → Created project "hello" — id proj_ab12cd34,
        budget $1.00.

You:    Under that project, review this diff: renamed getUser() to
        fetchUser() everywhere.
Claude: [run_agent projectId=proj_ab12cd34]
        → Agent started — runId run_ef56…. Watch it live on the console's
          Workflow page or the Chrome extension.

You:    How did it go?
Claude: [get_run_result runId=run_ef56…]
        → SETTLED — $0.31 across 9 providers.
          diff-explainer   [delivered]  https://lora.algokit.io/…
          guardrail-checker[delivered]  …
```

Nine providers. Nine distinct payees. **One signature.** One receipt.

---

## Budgets — nothing runs unbounded

No tool requires a budget number. Tag a run to a project created with
`budgetUSDC` and it is capped automatically at whatever headroom that project
has left; pass `budgetUSDC` explicitly only when you want a hard cap that
overrides it.

With no project at all, the run is still bounded by the router's own spend
policy — per-workflow ceiling, per-provider cap, hourly spend, rolling velocity,
provider trust, kill switch. That guard runs **before anything is signed**, so a
policy failure costs exactly $0.

---

## Run it standalone

```bash
ROUTER_URL=http://localhost:8080 AXIS_API_KEY=axis_yourkey node src/index.ts
npm run inspect      # opens the MCP Inspector against this server
```

It speaks JSON-RPC over stdio, so `stdout` is reserved for the protocol — all
diagnostics go to stderr.

---

## What happens when a provider takes the money and dies

`pay_and_run` and `run_agent` both surface it honestly. That leg is **reversed
on chain**, the refund txid lands in the same receipt, and the run comes back
`PARTIAL` rather than pretending it succeeded. Payment atomicity is not
delivery, and the receipt says so.

MIT licensed. Part of [AXIS](../../README.md) · built on [`axis-pay`](../sdk/README.md).
