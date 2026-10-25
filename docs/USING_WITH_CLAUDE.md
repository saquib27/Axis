# Using AXIS with Claude

Give Claude an AXIS API key and it can **spend real money on your behalf, atomically** —
pricing nine paid services, paying them all in one Algorand transaction group with a
single signature, and handing you back every result plus a receipt.

You watch the whole thing happen live in the Chrome extension and the console.

> **Do not name this file `CLAUDE.md`.** In Claude Code that filename is
> auto-loaded as project instructions. This is a human guide, not agent
> instructions.

---

## 1. What it actually does

You type a sentence. Claude calls AXIS tools. Behind that:

```
your sentence
   ↓  run_agent
an LLM picks a workflow that genuinely fits — or refuses
   ↓  quote        9 unpaid 402 probes, one per service       → costs $0
   ↓  policy       6 spend rules; a FAIL signs nothing        → costs $0
   ↓  compose      9 payment legs → ONE Algorand group
   ↓  simulate     free dry run; a bad group is never sent    → costs $0
   ↓  sign         ONE signature authorises all nine
   ↓  settle       ~3s, all-or-nothing
   ↓  deliver      results come back; any provider that took
                   money and failed is REFUNDED on chain
   ↓  receipt      one artifact: group id, 9 txids, refunds
```

Total for all nine services: **$0.31** (~$0.30 + $0.01 routing fee).

Everything before `settle` costs exactly **$0**. That is the whole design — a
failure at any gate is free.

---

## 2. Start the router

Claude talks to your local router, so it has to be up:

```bash
cd /Users/dushyant/AXIS/backend/router
npm start                       # → http://localhost:8080
```

The nine services are already deployed on Cloudflare Workers — nothing else to
start. Check it:

```bash
curl -s localhost:8080/healthz          # {"ok":true}
```

Optional, for watching: the console at `:3000`
(`cd frontend/console && npx next dev`).

---

## 3. Get your API key

Console → **Projects** page → the key bar at the top → **copy**.

It looks like `axis_a59f26f4…`. **This key is your account and it spends your
USDC — treat it like a password.** Everyone who uses AXIS gets their own from
their own signup; there is no shared key.

---

## 4. Connect your account

### The easy way — just tell Claude (no config editing)

Install the connector once with **no key at all**, then in chat:

```
Connect my AXIS account. My key is axis_a59f26f4…
```

Claude calls `connect_account`, verifies the key against the router, and
answers `Connected as you@example.com.` It is saved to `~/.axis/credentials`
(`0600`) so it survives restarts — you do this once, not every session.

This is the flow to demo, and the one to hand to other people: **sign up →
copy key → tell Claude to connect.** Nobody edits JSON.

- Wrong key? It is rejected *before* being stored, and whatever account was
  already connected stays connected.
- Switching accounts? `Disconnect my AXIS account.`
- Which account am I on? `Which AXIS account are you using?`

> **Tradeoff, stated plainly:** a key pasted into chat lives in that
> conversation's history. On a shared or recorded machine, prefer the env var
> below — it never enters the conversation.

### The env way — set it once at install

#### Claude Code — one command

```bash
claude mcp add axis-pay -s user \
  -e ROUTER_URL=http://localhost:8080 \
  -e AXIS_API_KEY=axis_YOUR_KEY_HERE \
  -- node /Users/dushyant/AXIS/backend/mcp/src/index.ts
```

`-s user` = available in every project. Confirm with `claude mcp list`, then
restart Claude Code.

### Claude Desktop — config file

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "axis-pay": {
      "command": "node",
      "args": ["/Users/dushyant/AXIS/backend/mcp/src/index.ts"],
      "env": {
        "ROUTER_URL": "http://localhost:8080",
        "AXIS_API_KEY": "axis_YOUR_KEY_HERE"
      }
    }
  }
}
```

Restart Claude Desktop. It appears under **Settings → Connectors** as
`axis-pay`. (Leave the `AXIS_API_KEY` line out entirely if you would rather
connect in chat — see above.)

**Forgot the key?** Every account tool tells you to just ask Claude to connect,
rather than failing with a bare error.

---

## 5. Watch it live

Before you send a prompt, open either or both:

- **Chrome extension** — paste the same API key into the connect screen. It
  follows only *your* runs and animates the whole flow.
- **Console** → Projects (or Workflow). Both poll, so they fill in on their own.

Timing worth knowing: the **extension goes live at quote time**, but
**receipts and spend land after settlement** — the run row is written when the
payment executes. Mid-run, watch the extension.

---

## 6. Prompts to paste into Claude

### Start here

```
Create an AXIS project called "hello" with a $2 budget.
```
```
List my AXIS projects.
```
```
What AXIS workflows can I run, and what does each cost?
```

### Price something without paying a cent

```
Quote the deep-review workflow on this diff: changed the request timeout
from 10 seconds to 60 seconds. Don't pay anything.
```
Returns all nine prices and the policy verdict. **No money moves.**

### Actually pay — all nine services, one signature

```
Under my "hello" project, run the AXIS agent on this task: review this diff —
renamed getUser() to fetchUser() across the codebase, and flag anything risky.
```

```
Use AXIS to review the file at /Users/dushyant/AXIS/backend/router/src/app.ts
and tell me what each service said.
```

### Check a result

```
Get the AXIS result for run_ab12cd34ef56.
```

### Watch it refuse (this is the point, not a bug)

```
Use AXIS to create an image of a cat.
```
```
Use AXIS to book me a flight to Delhi.
```
No paid service does those jobs, so the agent **declines and spends $0**. An
agent that will buy anything is worse than useless.

### Watch the budget bite

```
Create an AXIS project called "tiny" with a $0.05 budget, then run the agent
under it on: review this diff, added a null check.
```
The quote is ~$0.31, the ceiling is $0.05 → refused **before signing**, $0 spent.

---

## 7. The ten tools Claude gets

| Tool | What it does |
|---|---|
| `connect_account` | connect an account by key, in chat — verified, then remembered |
| `disconnect_account` | forget the stored key (switch accounts) |
| `whoami` | which account is this spending from? |
| `list_workflows` | every workflow, its services, its required inputs |
| `quote_workflow` | live prices from each 402 — **zero payment** |
| `pay_and_run` | settle one atomic group for a *named* workflow |
| `run_agent` | plain-English task → LLM picks the workflow, or refuses |
| `get_run_result` | a run's status, spend, and per-service results |
| `list_projects` | projects with spend, refunds, remaining budget |
| `create_project` | new project, optionally with a budget ceiling |

**`pay_and_run` vs `run_agent`:** `pay_and_run` needs the exact workflow id and
does what you said. `run_agent` needs only a goal and decides for itself —
including deciding not to spend.

---

## 8. Money rules

- **Budget is optional.** Tag a run to a budgeted project and the ceiling is
  automatic: whatever headroom that project has left.
- **No project, no budget → still bounded.** The router's spend policy
  (per-workflow ceiling, per-provider cap, hourly spend, rolling velocity,
  provider trust, kill switch) runs on every request, before anything is
  signed. There is no configuration where spending is unbounded.
- **A provider that takes money and fails is refunded on chain.** The run comes
  back `PARTIAL` with the refund txid in the same receipt. Payment atomicity is
  not delivery, and the receipt says so honestly.

---

## 9. When it doesn't work

| Symptom | Cause |
|---|---|
| `No AXIS account is connected yet` | tell Claude: `connect my AXIS account, key is axis_…` |
| `request failed (401)` | key is wrong, or missing on that call |
| `ECONNREFUSED` / tools time out | router isn't running — see §2 |
| Tools don't appear in Claude | didn't restart after adding the config |
| Extension shows `no key` | paste the key into the extension too |
| Console shows nothing | you're logged out; account data is default-deny |

---

See also: [`backend/mcp/README.md`](../backend/mcp/README.md) for the MCP server
itself, and [`backend/sdk/README.md`](../backend/sdk/README.md) for calling AXIS
from your own code instead of from Claude.
