# AXIS Live Monitor — Chrome extension

A side-panel that turns the AXIS agent's work into a **live animated flowchart**.
Click *"Run full review"* (or launch the autonomous agent) in the console and the
panel draws it in real time: boxes for every actor (agent wallet, router, spend guard, Neon DB, the
atomic group, all services, the facilitator), arrows between them, and **gold
coins that travel along the arrows when money moves** — forward on settle, and
**backward on a refund**. A plain-language caption narrates each backend step,
so a viewer sees exactly what the code does and *where state is stored* — without
reading any code.

What you watch happen, step by step:
- **all services** (fetched from `/v1/workflows`) are drawn; the ones this run
  uses light up, the rest are **crossed out (✕)** — never called, never paid
- unpaid **402 probes** fan out to the used providers; each box shows its price
- the signed **quote** is stored in **Neon** (caption says so)
- the **Spend Guard** turns green (pass) or red (blocked → nothing is signed)
- the **atomic group** forms; the **facilitator** lights up as fee-payer
- on **settle**, coins fly agent → group → each **used** provider; txids in Neon
- if a used provider fails, its coin travels **backward** to the agent — the
  on-chain refund, made visible

It is a pure read-only viewer over the same SSE stream the web console uses
(`GET /v1/runs/:id/events`). It never signs, never pays, never holds a key.

## Load it (unpacked)

1. Start the router (`node src/index.ts` in `backend/router`, port 8080).
2. Open `chrome://extensions`, toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Click the AXIS icon in the toolbar → the side panel opens.

## Use it

- **Connect with your account API key** — that is the only thing the panel
  needs. Copy it from the console's **Projects** page (the key bar at the top) and
  paste it in. Until a key is set the panel shows nothing: without one there
  is no account to follow, and falling back to the router's global latest run
  would show whatever somebody else happened to be running.
- With a key set, the panel auto-discovers *your* running agent via
  `GET /v1/runs/latest?key=…` and follows it — **no run id to paste**. Start a
  run in the console, or hand a task to Claude over MCP, and it fills in live.
  It never replays whatever run was already latest when the panel opened —
  only a run that starts *after* you open it is drawn.
- To point it at a deployed router, open **advanced** and set the URL
  (stored in `chrome.storage`, default `http://localhost:8080`).

## How it works

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest — side panel + host permission for the router |
| `background.js` | opens the side panel on toolbar click |
| `panel.html` | the panel markup + styling (self-contained) |
| `panel.js` | polls `/v1/runs/latest`, opens an `EventSource`, folds `RunEvent`s into the live view |

The event schema in `@axis/shared` is the only contract — the same events the
web console renders drive this panel, so the two can never disagree.


## Local live demo (no payments)

With the local preview API running, connect your account in the extension, then open the console `/attack` page and click **Start live demo**. It streams simulated discovery, settlement and refund events for your account. The extension displays a persistent DEMO label. Reload the unpacked extension after updating its files.

The demo makes no provider calls, signs no transactions and writes no financial ledger entries. Its displayed prices, transaction IDs and refund events are fictional. It is available only in the local preview API; the production router does not expose `/v1/demo/run`. The extension does not automatically run tasks from ordinary ChatGPT conversations.
