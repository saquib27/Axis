# AXIS — Simple prompts to try

Copy-paste these. Two places you can use AXIS: the **Autonomous agent** page in
the console, and **Claude** (via the axis-pay MCP tool).

> Full Claude setup — starting the router, adding your API key, watching it
> live — is in [`USING_WITH_CLAUDE.md`](USING_WITH_CLAUDE.md).

> **What AXIS can do now — 10 workflows over 9 paid services:**
> - `deep-review` — **all 9 services at once** in one atomic group ($0.31)
> - `pr-review` — the 4-service core review (diff, safety, commit critique, bug summary)
> - `security-scan` — just the safety check on code/text
> - `bug-hunt` — explain a change, then find bugs in it
> - `commit-polish` — improve a commit message
> - `generate-code` — write code for a task
> - `debug-error` — diagnose an error and propose a fix
> - `write-tests` — write unit tests for code
> - `translate-text` — translate text to a language
> - `summarize-text` — summarise a long piece of text
>
> The autonomous agent picks the right one from your goal; if none fits, it
> refuses and pays **nothing**. That refusal is a feature.

---

## A) Autonomous agent page (`/agent`)

Type one of these in the box, pick a project, click **Run agent**. There is no
budget field — spend is bounded by the project's budget if it has one, and by
AXIS's own spend policy either way.

### ✅ These WORK (it pays and shows results)
- `Review this pull request: it changes the login timeout from 10 to 60 seconds.`
- `Check this code change for bugs and security problems: it adds password hashing to the signup form.`
- `Review this change: it makes the payment function retry when it fails.`
- `Review this diff: renamed getUser() to fetchUser() everywhere in the app.`
- `Is this change safe to ship? It lets users upload profile pictures.`

### ✅ New services also work — try these
- `Write a Python function that reverses a string.`  (generate-code)
- `Debug this error: TypeError: cannot read property 'x' of undefined.`  (debug-error)
- `Write unit tests for this function: function add(a,b){return a+b}.`  (write-tests)
- `Translate "good morning, how are you?" to Spanish.`  (translate-text)
- `Summarise this: <paste a long paragraph>.`  (summarize-text)

### 🛑 These still get REFUSED (you pay $0) — no service for them
- `Create me an image of a cat.`  (no image model — text services only)
- `Book me a flight to Delhi.`
- `What's the weather today?`

### 💰 See the budget in action
Give a project a budget on the **Projects** page, then tag a run to it:
- Budget **$2.00** → it pays and delivers.
- Budget **$0.05** → it refuses: *too expensive*, and pays nothing.

---

## B) Claude Desktop (the axis-pay tool)

Just talk to Claude in plain English — it decides which tool to call.

### See what's available (no payment)
- `Using axis-pay, list the workflows you can run.`
- `Using axis-pay, quote deep-review for a change that bumps the timeout from 10 to 60 seconds. Don't pay — just tell me the price.`

### Pay and get results (real settlement, ~15s)
- `Using axis-pay, review this pull request and pay for it if it costs under $0.50: it adds email validation to the signup form.`
- `Use axis-pay to run deep-review on this diff, then summarise what all nine services said:`
  `- const timeout = 10`
  `+ const timeout = 60`

### Watch it refuse (you pay nothing)
- `Using axis-pay, create me an image of a cat.`  → no such service; it declines.
- `Using axis-pay, run deep-review but only if it costs under 5 cents.`  → too expensive; declines.

---

## The best thing to show (agent's whole point in 2 clicks)

1. **A working prompt** → it pays all 9 services in ONE atomic payment, results come back.
2. **`Create me an image`** → it refuses and pays $0.

That contrast is the pitch: **it only spends money when it can actually do the job.**
