/** Pooled Postgres (Neon) + Drizzle. One connection for the process. */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

let _db: ReturnType<typeof drizzle> | null = null;

export function db(url: string) {
  if (!_db) {
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
    const sql = postgres(url, { ssl: local ? false : "require", max: 5 });
    _db = drizzle(sql, { schema });
  }
  return _db;
}

export { schema };
