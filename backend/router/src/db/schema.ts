/**
 * Postgres schema.
 *
 * Two conventions that hold everywhere:
 *
 *  - Money is `bigint` microUSDC. Postgres NUMERIC would work but invites
 *    someone to read it as a float in JS; bigint mode keeps it exact end to end.
 *  - Timestamps are timestamptz. A receipt is a financial record; ambiguous
 *    local time is not acceptable in one.
 */
import {
  pgTable, text, bigint, integer, boolean, jsonb, timestamp, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** microUSDC helper — always bigint mode, never a JS number. */
const micro = (name: string) => bigint(name, { mode: "bigint" });

export const quotes = pgTable(
  "quotes",
  {
    id: text("id").primaryKey(),
    apiKey: text("api_key"),
    runId: text("run_id"),
    workflow: text("workflow").notNull(),
    agentAddress: text("agent_address").notNull(),
    inputs: jsonb("inputs").notNull(),
    dag: jsonb("dag").notNull(),
    legs: jsonb("legs").notNull(),
    subtotalMicro: micro("subtotal_micro").notNull(),
    routingFeeMicro: micro("routing_fee_micro").notNull(),
    totalMicro: micro("total_micro").notNull(),
    policyVerdict: jsonb("policy_verdict").notNull(),
    /** Router signature over the canonical quote body. Verified on execute. */
    signature: text("signature").notNull(),
    /** OPEN → CONSUMED is the single-use guard against replay. */
    status: text("status").notNull().default("OPEN"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quotes_agent_idx").on(t.agentAddress, t.createdAt), index("quotes_run_owner_idx").on(t.runId, t.apiKey)],
);

export const runs = pgTable("runs", {
  /** Also the receipt id — one run, one receipt, one identifier. */
  id: text("id").primaryKey(),
  /** Null when the run never reached a quote — an agent that refused the goal,
   *  or a policy block. Those runs still belong in the ledger: "we tried, and
   *  it cost $0" is information, and an invisible refusal looks like a bug. */
  quoteId: text("quote_id").references(() => quotes.id),
  workflow: text("workflow").notNull(),
  agentAddress: text("agent_address").notNull(),
  groupId: text("group_id"),
  status: text("status").notNull().default("PENDING"),
  /** Optional grouping — which project this run belongs to. */
  projectId: text("project_id"),
  /** Which account (API key) created this run — for per-account scoping. */
  apiKey: text("api_key"),
  totalMicro: micro("total_micro").notNull(),
  refundedMicro: micro("refunded_micro").notNull().default(sql`0`),
  confirmedRound: bigint("confirmed_round", { mode: "bigint" }),
  error: jsonb("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const legs = pgTable(
  "legs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id),
    stepId: text("step_id").notNull(),
    provider: text("provider").notNull(),
    payTo: text("pay_to").notNull(),
    priceMicro: micro("price_micro").notNull(),
    /** Index of this leg's transaction inside the atomic group. */
    groupIndex: integer("group_index"),
    txid: text("txid"),
    status: text("status").notNull().default("PAID"),
    attempts: integer("attempts").notNull().default(0),
    latencyMs: integer("latency_ms"),
    result: jsonb("result"),
    error: jsonb("error"),
    /** Set when a provider took payment and failed to deliver. */
    compensationTxid: text("compensation_txid"),
  },
  (t) => [index("legs_run_idx").on(t.runId)],
);

/** Feeds the rolling velocity limiter. One row per settled leg. */
export const spendEvents = pgTable(
  "spend_events",
  {
    id: text("id").primaryKey(),
    agentAddress: text("agent_address").notNull(),
    runId: text("run_id").notNull(),
    provider: text("provider").notNull(),
    amountMicro: micro("amount_micro").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // The velocity query is WHERE agent = $1 AND created_at > now() - 1 hour.
  // This composite index is what keeps it O(window) rather than O(history).
  (t) => [index("spend_agent_time_idx").on(t.agentAddress, t.createdAt)],
);

export const policies = pgTable("policies", {
  agentAddress: text("agent_address").primaryKey(),
  maxWorkflowMicro: micro("max_workflow_micro").notNull(),
  maxProviderMicro: micro("max_provider_micro").notNull(),
  maxHourlySpendMicro: micro("max_hourly_spend_micro").notNull(),
  maxHourlyCalls: integer("max_hourly_calls").notNull(),
  minProviderTrust: integer("min_provider_trust").notNull(),
  killSwitch: boolean("kill_switch").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Execute-once guarantee. A CI pipeline that retries a request must not pay
 * twice, so the response is stored and replayed for a repeated key.
 */
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  runId: text("run_id").notNull(),
  response: jsonb("response").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A named grouping for runs — "project-wise payment". Every run may point at a
 * project; the project view then aggregates its runs' spend and refunds.
 */
export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  agentAddress: text("agent_address"),
  /** Which account (API key) owns this project. Set at creation so a brand-new
   *  project shows up for its owner immediately, before it has any runs. */
  apiKey: text("api_key"),
  /** Optional total spend ceiling for this project. When set, the autonomous
   *  agent needs no per-run budget: each task automatically gets whatever
   *  headroom is left (budget minus this project's gross spend so far). Null
   *  means no project-level ceiling — the server's spend-policy limits are
   *  still enforced regardless. */
  budgetMicro: micro("budget_micro"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Console accounts. Plain JWT auth — no third-party provider. The password is
 * stored ONLY as a scrypt hash (salt:hash); the cleartext never touches the DB.
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  /** Per-account API key. Scopes runs/receipts/projects to THIS user; the
   *  extension uses it to see only this account's data. */
  apiKey: text("api_key").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
