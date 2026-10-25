Part 1 — The problem, in plain terms
Imagine an AI agent that reviews pull requests. To do its job it needs four different paid services:

one explains what a code diff does — 3¢
one checks the text for prompt-injection attacks — 2¢
one critiques the commit message — 3¢
one turns a messy bug report into repro steps — 5¢
Four different companies own those four services. Total cost: 13¢ per PR review.

Now: how does the agent pay them?

Today it pays each one separately. Four payments, four signatures, four receipts. And here's the part that actually hurts:

The agent pays service 1, 2 and 3. Then service 4 is down.
You've spent 8¢ and got nothing usable. No review. Money gone.

That's the problem. Payments don't compose. Individually they work fine; together they're fragile.

Part 2 — What x402 is
402 Payment Required is an HTTP status code that's existed since the 90s and was never used. The x402 protocol finally gave it a meaning:


1. Agent:    "Give me the diff explanation."
2. Server:   "402 Payment Required — send 3¢ USDC to address ABC..."
3. Agent:    signs a 3¢ payment
4. Agent:    "Here's my payment proof. Now give me the data."
5. Server:   verifies payment → returns the answer
No signup. No API key. No subscription. The machine pays, per call, and nobody creates an account. That's genuinely new — it's built for agents, not humans.

But x402 only solves ONE call. It has no concept of "these four calls belong together." That gap is what your hackathon track is asking people to fill.

Part 3 — Why Algorand specifically
Algorand has a feature most blockchains don't: atomic transaction groups.

You bundle up to 16 payments together and submit them as one unit. Then:

Either all 16 succeed, or all 16 fail. Never partial.

No smart contract. No escrow. It's built into the chain itself.

On Ethereum you'd have to write this — an escrow contract that holds money, releases it conditionally, refunds on failure. That's a payment processor, and you'd have to get it right. On Algorand you just... group the payments.

Three more things Algorand gives free:

simulateTransactions — a dry run. "Would this group work?" It checks balances, fees, everything, without spending anything. Catch failures for free.
Fee payer — someone else can pay the transaction fees. So your agent needs only USDC, never ALGO.
~3 second finality — fast enough to demo live.
This is the core argument of your submission. Not "we used a blockchain" — but "this specific thing is clean on Algorand and messy everywhere else."

Part 4 — What AXIS actually is
AXIS sits between the agent and the four services:


agent ──▶ AXIS ──┬──▶ diff explainer     3¢
                 ├──▶ guardrail checker  2¢
                 ├──▶ commit roaster     3¢
                 └──▶ bug summarizer     5¢

         ONE signature · ONE atomic group · ONE receipt · 13¢
Either everyone gets paid and every result comes back, or nothing settles and the agent is out zero.

Four things AXIS adds that plain x402 doesn't have:

Atomicity across providers	All four payments live or die together
One unified receipt	"This PR review cost 13¢" — one document, four transaction IDs
A spend limit that runs before signing	Agent stuck in a retry loop can't drain your wallet
Refunds when a provider takes money and fails	← this one is the killer, see below
That last one is the thing almost nobody else will build. Think about it:

The payment group succeeded. All four got paid.
Then provider #3's server crashes and returns an error.

You paid. You got nothing.

Payment succeeding ≠ service delivered. AXIS detects that, sends that provider's money back on-chain, and marks the run PARTIAL with the refund transaction ID printed on the receipt.

Everyone else stops at "the payment worked 🎉". That's your edge.

Part 5 — The pieces being built
Piece	What it is	Runs on
4 provider endpoints	The paid services. Each asks for money via 402, then calls Claude to do real work. Each has its own wallet.	Cloudflare Workers
The router	The brain. Gets prices, checks limits, builds the payment group, settles it, collects results, issues refunds, writes receipts.	A server (Railway)
The console	The dashboard a judge watches. One button → the whole thing happening live.	Next.js on Vercel
The database	Stores quotes and receipts so they survive a restart.	Postgres (Neon)
Part 6 — The phases, and why this order
The order isn't arbitrary. Each phase is built so that if it fails, you find out as cheaply as possible.

Phase 0 — De-risk ← we are here
Prove the one assumption everything else rests on: can Algorand actually send money to 4 different people in one group?

Why first: if the answer is no, the entire design is dead. Better to know on night one than on submission day. The answer turned out to be yes — I read the actual SDK code and confirmed it.

Phase 1 — Foundation
The shared vocabulary. What is a "quote"? A "receipt"? A "workflow"? Written once as strict definitions everything else imports. Plus the DAG resolver — the thing that figures out which services can run at the same time vs which must wait (the bug summarizer needs the diff explainer's output, so it goes second).

Why here: everything downstream speaks this language. Change it later and you rewrite everything.

Phase 2 — The four paid services
Build one real endpoint that genuinely returns 402, genuinely takes payment, genuinely calls Claude. Then clone it three times.

Why before the router: the router talks to these. Can't test the router against services that don't exist.

Phase 3 — The quote engine
The router asks all four "what do you cost?" and adds it up. No money moves. It reads the price out of each 402 challenge rather than hardcoding it.

Why before payment: you can test all the logic — pricing, ordering, dependencies — without spending a cent.

Phase 4 — Build, simulate, settle ← the actual submission
Compose the atomic group. Dry-run it. Get one signature. Settle. Four payments land together.

Why here: this is the claim. Everything before this exists to make this phase possible; everything after exists to make it visible.

Phase 5 — Execute + refunds + receipt
Call the four services with proof of payment, collect answers, refund anyone who took money and failed, write the receipt.

Phase 6 — Spend limits
Ceilings, hourly caps, kill switch. Runs before any signature, so a violation costs zero.

Phase 7 — The console
Make it all visible. This is what the judge actually stares at.

Phase 8 — Hardening
Stop double-payments when CI retries. Survive a crash mid-run.

Phase 9 — Deploy + rehearse
Live URLs, docs, and practising the demo twice.

The shape: prove the risky thing → build the vocabulary → build the parts → connect them → make it visible → make it survive → ship it.

Part 7 — Where you actually are

Phase 0  ████████░░  85%   only USDC missing (Circle's 2h limit)
Phase 1  █░░░░░░░░░  15%   scaffold exists, real work not started
Phase 2  ░░░░░░░░░░   0%
...
Already done and genuinely useful:

Confirmed the real package names (the old README had them wrong)
Confirmed the multi-payee design works by reading the SDK's actual source, not guessing
Fixed 4 wrong facts in your docs before they became bugs
Created + funded the wallets, opted all five into USDC
Found and fixed 2 real bugs in my own scripts
The single sentence version, for when a judge asks:

"Everyone else built an agent that pays for things. We built the thing that lets any agent pay ten services at once — atomically, one signature, one receipt — and get its money back when a provider takes payment and fails to deliver."

Two hours until the faucet resets. I'm going to build Phase 1 in that window — schemas, the DAG resolver, its tests, the database tables. Want me to explain each piece as I write it, so you actually know what's in your repo? Or just build and explain after?

