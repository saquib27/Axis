ALTER TABLE "runs" ADD COLUMN "api_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "api_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_api_key_unique" UNIQUE("api_key");