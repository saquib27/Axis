CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"step_id" text NOT NULL,
	"provider" text NOT NULL,
	"pay_to" text NOT NULL,
	"price_micro" bigint NOT NULL,
	"group_index" integer,
	"txid" text,
	"status" text DEFAULT 'PAID' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"result" jsonb,
	"error" jsonb,
	"compensation_txid" text
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"agent_address" text PRIMARY KEY NOT NULL,
	"max_workflow_micro" bigint NOT NULL,
	"max_provider_micro" bigint NOT NULL,
	"max_hourly_spend_micro" bigint NOT NULL,
	"max_hourly_calls" integer NOT NULL,
	"min_provider_trust" integer NOT NULL,
	"kill_switch" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow" text NOT NULL,
	"agent_address" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"dag" jsonb NOT NULL,
	"legs" jsonb NOT NULL,
	"subtotal_micro" bigint NOT NULL,
	"routing_fee_micro" bigint NOT NULL,
	"total_micro" bigint NOT NULL,
	"policy_verdict" jsonb NOT NULL,
	"signature" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"quote_id" text NOT NULL,
	"workflow" text NOT NULL,
	"agent_address" text NOT NULL,
	"group_id" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"total_micro" bigint NOT NULL,
	"refunded_micro" bigint DEFAULT 0 NOT NULL,
	"confirmed_round" bigint,
	"error" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spend_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_address" text NOT NULL,
	"run_id" text NOT NULL,
	"provider" text NOT NULL,
	"amount_micro" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legs" ADD CONSTRAINT "legs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legs_run_idx" ON "legs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "quotes_agent_idx" ON "quotes" USING btree ("agent_address","created_at");--> statement-breakpoint
CREATE INDEX "spend_agent_time_idx" ON "spend_events" USING btree ("agent_address","created_at");