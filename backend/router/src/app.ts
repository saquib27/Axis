/**
 * The AXIS router — Hono app.
 *
 * Phase 3 surface: quote (price discovery, zero payments) + the SSE event
 * stream that drives the console + health. Execute/receipt land in Phase 4/5.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { AxisError, mockRun } from "@axis/shared";
import type { Config } from "./config.ts";
import { WORKFLOWS } from "./workflows/pr-review.ts";
import { buildQuote, quoteToJson, persistQuote } from "./engine/quote.ts";
import { subscribe, isFinished, emit } from "./bus.ts";
import { setLatestRun, getLatestRun, liveRunOwner } from "./tenancy.ts";
import { execute } from "./engine/execute.ts";
import { buildReceipt, listReceipts, listRefunds, usageSummary, createProject, listProjects, projectDetail } from "./engine/receipt.ts";
import { signup, login, accountForKey } from "./engine/auth.ts";
import { getStored, store } from "./middleware/idempotency.ts";
import { allow } from "./middleware/ratelimit.ts";
import { db } from "./db/client.ts";
import { runs, quotes, projects } from "./db/schema.ts";
import { eq, and } from "drizzle-orm";
import { runAgentInline } from "./engine/agent.ts";
import { agentAccount } from "./chain/client.ts";
import { randomUUID } from "node:crypto";

const requestKey = (c: import("hono").Context) => c.req.header("x-api-key") ?? c.req.query("key");

export function createApp(cfg: Config, options: { paymentsEnabled?: boolean } = {}) {
  const paymentsEnabled = options.paymentsEnabled ?? true;
  const app = new Hono();

  // The router's own funded wallet — the default payer. Computed once so the
  // frontend never has to hardcode an agent address.
  const routerAgentAddress = paymentsEnabled ? String(agentAccount(cfg).agent.addr) : "";

  // The console (browser) calls quote/execute and opens the SSE stream.
  app.use("*", cors({ origin: "*", allowHeaders: ["content-type", "idempotency-key", "authorization", "x-api-key"], allowMethods: ["GET", "POST", "OPTIONS"] }));

  app.get("/healthz", (c) => c.json({ ok: true }));

  if (!paymentsEnabled) {
    app.use("*", async (c, next) => {
      if (c.req.path === "/readyz" || c.req.path.startsWith("/v1/workflow/") || c.req.path === "/v1/agent/run" || c.req.path.startsWith("/v1/redteam/")) {
        return c.json({ error: { code: "PAYMENTS_NOT_CONFIGURED", message: "Payments are not configured in this local preview. Accounts and projects are available." } }, 503);
      }
      await next();
    });
  }

  // Authenticate every private route, including writes and EventSource clients.
  app.use("/v1/*", async (c, next) => {
    if (["/v1/auth/signup", "/v1/auth/login", "/v1/workflows"].includes(c.req.path)) return next();
    const key = requestKey(c) ?? c.req.query("key");
    if (!key || !await accountForKey(key, cfg.DATABASE_URL)) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "a valid account API key is required" } }, 401);
    }
    await next();
  });

  async function ownsRun(runId: string, key: string): Promise<boolean> {
    const database = db(cfg.DATABASE_URL);
    if (liveRunOwner(runId) === key) return true;
    const run = await database.select({ id: runs.id }).from(runs)
      .where(and(eq(runs.id, runId), eq(runs.apiKey, key)));
    if (run.length) return true;
    const quote = await database.select({ id: quotes.id }).from(quotes)
      .where(and(eq(quotes.runId, runId), eq(quotes.apiKey, key)));
    return quote.length > 0;
  }


  // ── Auth. Plain JWT, no third-party provider. Off the money path entirely. ──
  const authHandler = (fn: typeof signup | typeof login) => async (c: import("hono").Context) => {
    let body: { email?: string; password?: string };
    try { body = await c.req.json(); } catch {
      return c.json({ error: { code: "INVALID_INPUT", message: "body must be JSON" } }, 400);
    }
    try {
      const out = await fn(body.email ?? "", body.password ?? "", cfg.DATABASE_URL, cfg.JWT_SECRET);
      return c.json(out);
    } catch (e) {
      if (e instanceof AxisError) return c.json({ ...e.toJSON() }, e.http as 400 | 401 | 409);
      return c.json({ error: { code: "INTERNAL", message: (e as Error).message } }, 500);
    }
  };
  app.post("/v1/auth/signup", authHandler(signup));
  app.post("/v1/auth/login", authHandler(login));

  if (!paymentsEnabled) {
    const activeDemos = new Set<string>();
    app.post("/v1/demo/run", (c) => {
      const key = requestKey(c)!;
      if (activeDemos.has(key)) return c.json({ error: { code: "DEMO_RUNNING", message: "A demo is already running for this account." } }, 409);
      const runId = `demo_${randomUUID()}`;
      activeDemos.add(key);
      setLatestRun(key, runId);
      void (async () => {
        try {
          for await (const event of mockRun({ scenario: "partial", speed: 0.7 })) {
            const { seq, at, runId: fixtureId, ...raw } = event;
            if (raw.type === "run.started") raw.workflow = "DEMO — no payments or provider calls";
            if (raw.type === "group.settled") raw.txids = raw.txids.map((tx) => ({ ...tx, explorerUrl: "" }));
            if (raw.type === "compensation.issued") raw.explorerUrl = "";
            if (raw.type === "run.completed") raw.receiptId = runId;
            emit(runId, raw);
          }
        } catch {
          emit(runId, { type: "run.error", code: "DEMO_FAILED", message: "Demo playback stopped. No payment was made.", costedNothing: true });
        } finally { activeDemos.delete(key); }
      })();
      return c.json({ runId, demo: true, message: "Simulated events only. No payments, provider calls or ledger entries." });
    });
  }


  app.get("/readyz", async (c) => {
    // Ready = every configured provider answers its /health.
    const steps = WORKFLOWS["pr-review"]?.steps ?? [];
    const checks = await Promise.allSettled(
      steps.map(async (step) => {
        const base = cfg[step.endpointEnv as keyof Config] as string;
        const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4000) });
        if (!r.ok) throw new Error(`${step.provider} ${r.status}`);
      }),
    );
    const down = checks
      .map((r, i) => (r.status === "rejected" ? steps[i]!.provider : null))
      .filter(Boolean);
    return c.json({ ok: down.length === 0, ...(down.length ? { down } : {}) }, down.length ? 503 : 200);
  });

  /**
   * POST /v1/workflow/quote — fan out unpaid probes, return a signed quote.
   * No payment occurs. A runId is minted so the console can stream the probes
   * and challenges live via GET /v1/runs/:id/events.
   */
  app.post("/v1/workflow/quote", async (c) => {
    let body: { workflow?: string; agentAddress?: string; inputs?: Record<string, unknown> };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: "INVALID_WORKFLOW", message: "body must be JSON" } }, 400);
    }

    const workflow = WORKFLOWS[body.workflow ?? "pr-review"];
    if (!workflow) {
      return c.json({ error: { code: "INVALID_WORKFLOW", message: `unknown workflow ${body.workflow}` } }, 400);
    }
    // Default to the router's own wallet when the caller doesn't supply one,
    // so the console/agent never hardcode an address.
    const agentAddress = body.agentAddress || routerAgentAddress;
    if (agentAddress !== routerAgentAddress) {
      return c.json({ error: { code: "INVALID_WORKFLOW", message: "agentAddress must match the router payer" } }, 400);
    }

    const runId = `run_${randomUUID().slice(0, 12)}`;
    // Remember this account's latest run so the extension can follow only theirs.
    setLatestRun(requestKey(c), runId);
    try {
      const quote = await buildQuote(workflow, agentAddress, body.inputs ?? {}, cfg, runId);
      await persistQuote(quote, body.inputs ?? {}, cfg.DATABASE_URL, requestKey(c) ?? c.req.query("key"), runId);
      // A policy FAIL is returned with the quote (402) so the console can show
      // exactly which rule blocked it — but it is a hard block: execute will
      // refuse a quote whose stored verdict is FAIL.
      const status = quote.policy.verdict === "FAIL" ? 402 : 200;
      return c.json({ runId, ...quoteToJson(quote) }, status);
    } catch (e) {
      if (e instanceof AxisError) {
        return c.json({ runId, ...e.toJSON() }, e.http as 400 | 402 | 502);
      }
      return c.json({ runId, error: { code: "INTERNAL", message: (e as Error).message } }, 500);
    }
  });

  /**
   * POST /v1/workflow/execute — compose, simulate, settle the atomic group.
   * The one endpoint where money actually moves. Requires an Idempotency-Key.
   */
  app.post("/v1/workflow/execute", async (c) => {
    let body: { quoteId?: string; chaos?: string; runId?: string; projectId?: string };
    try { body = await c.req.json(); } catch {
      return c.json({ error: { code: "INVALID_WORKFLOW", message: "body must be JSON" } }, 400);
    }
    if (!body.quoteId) {
      return c.json({ error: { code: "INVALID_WORKFLOW", message: "quoteId required" } }, 400);
    }
    // Reuse the runId minted at quote time so the console — already subscribed
    // to that run's SSE stream — sees the settle and execute events too. Only
    // mint a fresh one if the client did not carry it through.
    // Rate limit per caller (IP). Keying on the idempotency key would defeat
    // the limit, since each key is unique per request.
    const idemKey = c.req.header("Idempotency-Key");
    const caller = c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip") ?? "local";
    if (!allow(caller)) return c.json({ error: { code: "RATE_LIMITED", message: "too many requests" } }, 429);

    // Idempotent replay: a retry with the same key returns the stored response.
    if (idemKey) {
      const prior = await getStored(`${requestKey(c)}:${idemKey}`, cfg);
      if (prior) return c.json(prior as object);
    }

    const runId = body.runId ?? `run_${crypto.randomUUID().slice(0, 12)}`;
    try {
      const result = await execute(body.quoteId, cfg, runId, body.chaos, body.projectId, requestKey(c));
      if (idemKey) await store(`${requestKey(c)}:${idemKey}`, runId, result, cfg);
      return c.json(result);
    } catch (e) {
      if (e instanceof AxisError) return c.json({ runId, ...e.toJSON() }, e.http as 400 | 402 | 409 | 500);
      return c.json({ runId, error: { code: "INTERNAL", message: (e as Error).message } }, 500);
    }
  });

  app.post("/v1/redteam/*", (c) => c.json({ error: {
    code: "DEMO_DISABLED", message: "direct-payment attack demos are disabled; use the guarded workflow API",
  } }, 403));

  /**
   * POST /v1/agent/run — the autonomous agent from the console. An LLM picks a
   * workflow from the goal; it settles atomically only within budget. Returns a
   * runId immediately and streams the whole run on it (the console + extension
   * animate it live); the agent finishes in the background.
   */
  app.post("/v1/agent/run", async (c) => {
    let body: { goal?: string; budgetUSDC?: number; projectId?: string };
    try { body = await c.req.json(); } catch {
      return c.json({ error: { code: "INVALID_INPUT", message: "body must be JSON" } }, 400);
    }
    const goal = String(body.goal ?? "").trim();
    if (!goal) return c.json({ error: { code: "INVALID_INPUT", message: "goal is required" } }, 400);
    // Budget is optional: a project with its own budget supplies the ceiling
    // automatically (whatever headroom is left); with no project, or a caller
    // that wants its own hard cap, an explicit budgetUSDC still works.
    let budgetUSDC: number | undefined;
    if (body.budgetUSDC != null) {
      budgetUSDC = Number(body.budgetUSDC);
      if (!Number.isFinite(budgetUSDC) || budgetUSDC <= 0) {
        return c.json({ error: { code: "INVALID_INPUT", message: "budgetUSDC must be a positive number" } }, 400);
      }
    }
    if (body.projectId) {
      const owned = await db(cfg.DATABASE_URL).select({ id: projects.id }).from(projects)
        .where(and(eq(projects.id, body.projectId), eq(projects.apiKey, requestKey(c)!)));
      if (!owned.length) return c.json({ error: { code: "NOT_FOUND", message: "no such project" } }, 404);
    }
    const runId = `run_${randomUUID().slice(0, 12)}`;
    const apiKey = requestKey(c);
    setLatestRun(apiKey, runId);
    void runAgentInline(runId, goal, cfg, body.projectId, apiKey, budgetUSDC); // fire-and-forget; streams on runId
    return c.json({ runId });
  });

  // The account API key comes on a header (console) or ?key= (extension).
  const acct = (c: import("hono").Context) => requestKey(c) ?? c.req.query("key") ?? undefined;

  /**
   * Account data is default-DENY. An anonymous caller gets an empty list, not
   * everyone's. Returning global data when the key is merely absent means a
   * logged-out console — or an MCP client someone forgot to configure — reads
   * every tenant's projects and spend. Deny is the only safe default here.
   */
  const NO_ACCOUNT = { code: "NO_ACCOUNT", message: "an account API key is required (x-api-key header, or ?key= for the extension)" };
  const requireAcct = (c: import("hono").Context) => acct(c) ?? null;

  /** GET /v1/me — whose account is this key? A key spends real money, so any
   *  client acting on it must be able to name the owner before it does. */
  app.get("/v1/me", async (c) => {
    const key = requireAcct(c);
    if (!key) return c.json({ error: NO_ACCOUNT }, 401);
    const acc = await accountForKey(key, cfg.DATABASE_URL);
    if (!acc) return c.json({ error: { code: "UNKNOWN_KEY", message: "this API key does not belong to any account" } }, 401);
    return c.json({ id: acc.id, email: acc.email });
  });

  /** GET /v1/refunds — this account's runs that got money back on chain. */
  app.get("/v1/refunds", async (c) => {
    const key = requireAcct(c);
    if (!key) return c.json({ refunds: [], error: NO_ACCOUNT }, 401);
    return c.json({ refunds: await listRefunds(cfg.DATABASE_URL, 100, key) });
  });

  /** GET /v1/usage — spend totals for this account. */
  app.get("/v1/usage", async (c) => {
    const key = requireAcct(c);
    if (!key) return c.json({ runs: 0, settled: 0, partial: 0, failed: 0, grossUSDC: "0", refundedUSDC: "0", netUSDC: "0", error: NO_ACCOUNT }, 401);
    return c.json(await usageSummary(cfg.DATABASE_URL, key));
  });

  /** Projects — group runs and see per-project spend. */
  app.post("/v1/projects", async (c) => {
    let body: { name?: string; agentAddress?: string; budgetUSDC?: number };
    try { body = await c.req.json(); } catch { return c.json({ error: { code: "INVALID_INPUT", message: "body must be JSON" } }, 400); }
    const name = String(body.name ?? "").trim();
    if (!name) return c.json({ error: { code: "INVALID_INPUT", message: "name is required" } }, 400);
    if (body.budgetUSDC != null && (!Number.isFinite(body.budgetUSDC) || body.budgetUSDC <= 0)) {
      return c.json({ error: { code: "INVALID_INPUT", message: "budgetUSDC must be a positive number" } }, 400);
    }
    const key = requireAcct(c);
    if (!key) return c.json({ error: NO_ACCOUNT }, 401);
    return c.json(await createProject(cfg.DATABASE_URL, name, body.agentAddress, key, body.budgetUSDC));
  });
  app.get("/v1/projects", async (c) => {
    const key = requireAcct(c);
    if (!key) return c.json({ projects: [], error: NO_ACCOUNT }, 401);
    return c.json({ projects: await listProjects(cfg.DATABASE_URL, key) });
  });
  app.get("/v1/projects/:id", async (c) => {
    const key = requireAcct(c);
    if (!key) return c.json({ error: NO_ACCOUNT }, 401);
    const detail = await projectDetail(cfg.DATABASE_URL, c.req.param("id"), key);
    if (!detail) return c.json({ error: { code: "NOT_FOUND", message: "no such project" } }, 404);
    return c.json(detail);
  });

  /** GET /v1/workflows — the workflows an agent can run (id + provider steps). */
  app.get("/v1/workflows", (c) => {
    return c.json({
      workflows: Object.values(WORKFLOWS).map((w) => ({
        id: w.id,
        steps: w.steps.map((s) => ({ id: s.id, provider: s.provider, path: s.path })),
        inputs: [...new Set(w.steps.flatMap((s) =>
          Object.values(s.input).flatMap((t) =>
            typeof t === "string" ? [...t.matchAll(/\$\{\s*inputs\.([A-Za-z0-9_]+)\s*\}/g)].map((m) => m[1]!) : []),
        ))],
      })),
    });
  });

  /** GET /v1/receipts — this account's runs, newest first. The receipts index. */
  app.get("/v1/receipts", async (c) => {
    const key = requireAcct(c);
    if (!key) return c.json({ receipts: [], error: NO_ACCOUNT }, 401);
    return c.json({ receipts: await listReceipts(cfg.DATABASE_URL, 100, key) });
  });

  /** GET /v1/receipt/:id — the unified receipt. Renders standalone. */
  app.get("/v1/receipt/:id", async (c) => {
    const receipt = await buildReceipt(c.req.param("id"), cfg.DATABASE_URL, requestKey(c));
    if (!receipt) return c.json({ error: { code: "NOT_FOUND", message: "no such receipt" } }, 404);
    return c.json(receipt);
  });

  /** GET /v1/runs/latest — the most recent run for THIS account. Anonymous
   *  callers get nothing: falling back to the global latest run would hand a
   *  stranger's live activity to anyone who opened the extension. */
  app.get("/v1/runs/latest", (c) => {
    const key = requireAcct(c);
    if (!key) return c.json({ runId: null, error: NO_ACCOUNT }, 401);
    const runId = getLatestRun(key);
    // `live` lets a monitor tell "still running, join in" from "already over,
    // don't replay it" — the difference between useful and noise on open.
    return c.json({ runId, live: runId ? !isFinished(runId) : false });
  });

  /** GET /v1/runs/:id/events — the live SSE stream the console renders. */
  app.get("/v1/runs/:id/events", async (c) => {
    const runId = c.req.param("id");
    if (!await ownsRun(runId, requestKey(c)!)) return c.json({ error: { code: "NOT_FOUND", message: "no such run" } }, 404);
    return new Response(
      new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          const send = (data: string) => controller.enqueue(enc.encode(data));
          send(`: connected\n\n`);
          const unsub = subscribe(runId, (e) => {
            send(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
          });
          const ping = setInterval(() => send(`: ping\n\n`), 15_000);
          c.req.raw.signal.addEventListener("abort", () => {
            clearInterval(ping);
            unsub();
            try { controller.close(); } catch { /* already closed */ }
          });
        },
      }),
      { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "connection": "keep-alive" } },
    );
  });

  return app;
}
