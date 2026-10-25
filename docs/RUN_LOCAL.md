## Project-local tools

This checkout has Node 24.22.1 and the pinned pnpm 11.0.9 installed under
`.local-tools/` (ignored by Git). Run commands from the project root:

```bash
./scripts/pnpm test
./scripts/pnpm typecheck
./scripts/pnpm build
./scripts/pnpm dev:db
./scripts/pnpm dev:local-api
./scripts/pnpm --filter @axis/console dev
```

For direct `node` commands below, activate the local runtime in each terminal:

```bash
export PATH="$PWD/.local-tools/node/bin:$PATH"
```

On a fresh clone, install Node using `.nvmrc`, then install pnpm 11.0.9 and run
`pnpm install --frozen-lockfile`. The local wrapper requires the runtimes bundled
in this checkout; standard `pnpm` works when those tools are installed globally.

# Local console preview with PostgreSQL

The local preview uses real persistent PostgreSQL for signup/login, projects and account data. Blockchain payments are disabled explicitly. The normal production router remains `backend/router/src/index.ts`.

Use Node 24 (or a Node 22.18+ build with native TypeScript support). Some system Node builds omit TypeScript support; the bundled Node runtime works.

One-time runtime installation from `.`:

```bash
npm install --prefix .local-tools/postgres --ignore-scripts --no-audit --no-fund embedded-postgres@18.4.0-beta.17
(cd .local-tools/postgres/node_modules/@embedded-postgres/linux-x64 && node scripts/hydrate-symlinks.js)
```

Start these in three terminals from `.`:

```bash
node scripts/local-db.mjs
node backend/router/src/local.ts
node frontend/console/node_modules/next/dist/bin/next dev frontend/console -p 3000
```

Open http://localhost:3000/signup. The database binds only to `127.0.0.1:55432`; the local API binds to `127.0.0.1:8080`. The API applies pending migrations on startup. Local PostgreSQL connections disable TLS on loopback; remote database connections still require TLS.

The database launcher generates random credentials in gitignored `backend/router/.env.local` with mode 0600. Data persists under gitignored `.local/postgres`; downloaded binaries live under gitignored `.local-tools/postgres`. Keep both the database and its local config across restarts. No system PostgreSQL service is installed.

For blockchain execution, configure and run the full router below instead of the local preview API.

---

# Run AXIS locally

Two terminals in `.`:

```bash
# terminal 1 — router (quote · execute · receipt · SSE)  → :8080
cd backend/router && node src/index.ts

# terminal 2 — console  → :3000
cd frontend/console && NEXT_PUBLIC_ROUTER_URL=http://localhost:8080 npx next dev
```

Open http://localhost:3000 → click **"Run full review"**.

- `node src/index.ts` needs Node 22.18+ (native TypeScript).
- Prefer `npx next dev` over `pnpm dev` (pnpm 11's pre-run dep check can choke
  on the optional `sharp` native build).
- Watch a refund (PARTIAL): execute accepts a demo `{ "chaos": "roast" }` flag.
