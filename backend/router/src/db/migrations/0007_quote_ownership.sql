ALTER TABLE "quotes" ADD COLUMN "api_key" text;
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "run_id" text;
--> statement-breakpoint
CREATE INDEX "quotes_run_owner_idx" ON "quotes" ("run_id", "api_key");
--> statement-breakpoint
-- Restore ownership for historical quotes that already have an account run.
UPDATE quotes q SET api_key = r.api_key, run_id = r.id
FROM runs r WHERE r.quote_id = q.id AND r.api_key IS NOT NULL;
--> statement-breakpoint
-- Older code could mark a paid run FAILED. Preserve its spend and reconcile it.
UPDATE runs r SET status = 'RECOVERY_REQUIRED', finished_at = NULL
WHERE r.status = 'FAILED' AND (r.group_id IS NOT NULL OR EXISTS (
  SELECT 1 FROM legs l WHERE l.run_id = r.id AND l.txid IS NOT NULL
));
--> statement-breakpoint
-- Backfill recorded payments so existing history also feeds velocity limits.
INSERT INTO "spend_events" ("id", "agent_address", "run_id", "provider", "amount_micro", "created_at")
SELECT 'backfill:' || l.id, r.agent_address, r.id, l.provider, l.price_micro, r.started_at
FROM legs l JOIN runs r ON r.id = l.run_id
WHERE l.txid IS NOT NULL AND l.status <> 'SUBMITTING'
AND NOT EXISTS (SELECT 1 FROM spend_events s WHERE s.run_id = r.id AND s.provider = l.provider)
ON CONFLICT DO NOTHING;
