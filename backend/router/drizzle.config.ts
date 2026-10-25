import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
config({ path: "../../.env", quiet: true });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  // Neon's pooled endpoint can choke on DDL; migrations use the direct one.
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!,
  },
});
