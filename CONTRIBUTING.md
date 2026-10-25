# Working on AXIS

## 1. Accept the invite

Check your email, or go to **github.com/notifications** → accept the invite to
`Dushyant-web/ASIX`. You cannot push until you do.

## 2. Clone

```bash
git clone https://github.com/Dushyant-web/ASIX.git axis
cd axis
```

## 3. Set your git identity **for this repo only**

Do this before your first commit. If your machine's global git config belongs to
someone else, your commits will land under their name.

```bash
git config --local user.name  "<your-github-username>"
git config --local user.email "<your-github-email>"

# Keeps your GitHub credential separate from anyone else's on the same machine
git config --local credential.useHttpPath true
git config --local credential.username "<your-github-username>"
```

Verify:

```bash
git config --local user.name && git config --local user.email
```

## 4. Work on your own branch

Everyone has one. Never commit straight to `main`.

```bash
git checkout sarthak     # or: saquib, aarjav
git pull origin main     # start from the latest
```

## 5. Install and run

Requires **Node 22.18+** (we use native TypeScript type stripping — no `tsx`).

```bash
pnpm install
pnpm test        # must be green before you commit
pnpm typecheck
```

## 6. Commit and push

```bash
git add -A
git commit -m "phase(N): what you changed"
git push origin <your-branch>
```

**First push asks for a password — that is a Personal Access Token, not your
GitHub password.** GitHub disabled password auth for git in 2021.

Create one at **github.com/settings/tokens/new** → tick **`repo`** → Generate →
copy it (shown once) → paste it at the password prompt. It's saved to your
keychain afterwards.

## 7. Open a PR into `main`

On GitHub: **Compare & pull request** → base `main`, compare your branch.

---

## Rules

1. **`pnpm test` and `pnpm typecheck` must pass before you commit.** A broken
   `main` at 2am is how hackathons die.
2. **Never commit secrets.** `.env`, `.env.accounts`, mnemonics, API keys. They
   are gitignored — keep it that way.
3. **Money is `bigint` microUSDC, never a `number`.** Use `parseUSDC` /
   `formatUSDC` from `@axis/shared`. A float in a payment path is a real bug.
4. **Read `docs/BUILD_PLAN.md` before starting a phase.** Each phase has a
   Definition of Done. Don't start the next one until the current one passes.
5. **Don't change `docs/PROTOCOL.md` from memory.** Everything in it was
   read out of the installed SDKs. If it looks wrong, verify against the
   package, then update it with what you found.

## Where things live

```

├── backend/
│   ├── shared/       types, schemas, money, DAG resolver   ← everything imports this
│   ├── guard/        spend policy
│   ├── router/       the engine: quote → policy → compose → settle → execute
│   ├── providers/    the 4 paid x402 endpoints
│   └── scripts/      testnet account + spike tooling
├── frontend/console/ the live dashboard
└── docs/PROTOCOL.md  verified facts about the x402 SDKs — read this first
```
