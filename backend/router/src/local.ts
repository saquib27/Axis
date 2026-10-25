/** Local console server: real PostgreSQL accounts/projects, payments disabled. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { z } from "zod";
import { serve } from "@hono/node-server";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./db/client.ts";
import { createApp } from "./app.ts";
import type { Config } from "./config.ts";

const config = z.object({
  DATABASE_URL: z.string().url().refine((value) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname), "local mode requires a loopback database"),
  JWT_SECRET: z.string().min(32),
}).parse(parse(readFileSync(new URL("../.env.local", import.meta.url))));

await migrate(db(config.DATABASE_URL), {
  migrationsFolder: fileURLToPath(new URL("./db/migrations", import.meta.url)),
});
// Payment routes are disabled before handlers can read payment configuration.
const app = createApp(config as Config, { paymentsEnabled: false });
serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 8080 }, () => {
  console.log("Local console API ready at http://localhost:8080 (payments disabled)");
});
