/**
 * Configuration, validated once at boot.
 *
 * If a variable is missing or malformed the process EXITS with a message naming
 * it. The alternative is `undefined` surfacing three layers deep during the
 * demo, as a failed transaction, in front of judges.
 */
import { z } from "zod";
import { config as loadEnv } from "dotenv";
import { ALGORAND_TESTNET_CAIP2, USDC_TESTNET_ASA_ID } from "@axis/shared";

// Load the repo .env and the gitignored accounts file (payTo + mnemonic).
// Values with characters like & would break shell sourcing; dotenv handles them.
loadEnv({ path: "../../.env.accounts", quiet: true });
loadEnv({ path: "../../.env", quiet: true });

const zMicro = z
  .string()
  .regex(/^\d+$/, "must be an integer number of microUSDC")
  .transform((v) => BigInt(v));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),

  // Network — CAIP-2 is the genesis-hash form, never "algorand:testnet".
  NETWORK: z.string().default(ALGORAND_TESTNET_CAIP2),
  ALGOD_URL: z.string().url().default("https://testnet-api.algonode.cloud"),
  INDEXER_URL: z.string().url().default("https://testnet-idx.algonode.cloud"),
  USDC_ASA_ID: z.string().regex(/^\d+$/).default(USDC_TESTNET_ASA_ID),

  FACILITATOR_URL: z.string().url().default("https://facilitator.goplausible.xyz"),

  // Provider payout addresses — must be present, 58 chars, and DISTINCT.
  PAY_TO_DIFF: z.string().length(58),
  PAY_TO_GUARDRAIL: z.string().length(58),
  PAY_TO_ROASTER: z.string().length(58),
  PAY_TO_BUGSUM: z.string().length(58),

  PROVIDER_DIFF_URL: z.string().url(),
  PROVIDER_GUARDRAIL_URL: z.string().url(),
  PROVIDER_ROASTER_URL: z.string().url(),
  PROVIDER_BUGSUM_URL: z.string().url(),
  // The toolbox Worker — 5 extra services. Optional: workflows that use it just
  // fail to quote if it's unset, without blocking the core providers.
  PROVIDER_TOOLBOX_URL: z.string().url().optional(),

  /** 25 words. Hosting dashboards wrap long values in a textarea and happily
   *  store the newline, which makes the mnemonic fail to decode with an error
   *  that says nothing about whitespace. Collapse any run of whitespace to a
   *  single space so a pasted-with-newlines value still works. */
  AGENT_MNEMONIC: z.string().min(1).transform((s) => s.trim().replace(/\s+/g, " ")),
  QUOTE_SIGNING_KEY: z.string().min(32, "use at least 32 chars of entropy"),

  // Signs console session JWTs. Not on the money path; a dev default is fine
  // locally, but set a real secret in any shared deploy.
  JWT_SECRET: z.string().min(16).default("axis-dev-jwt-secret-change-me-please"),

  // NVIDIA NIM — powers the autonomous agent's workflow choice. Optional: with
  // no key the agent falls back to the first workflow.
  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_BASE_URL: z.string().url().optional(),
  NVIDIA_MODEL: z.string().optional(),

  DATABASE_URL: z.string().url(),

  MAX_WORKFLOW_SPEND_MICRO: zMicro.default("1000000"),
  MAX_PROVIDER_SPEND_MICRO: zMicro.default("500000"),
  MAX_HOURLY_SPEND_MICRO: zMicro.default("10000000"),
  MAX_HOURLY_CALLS: z.coerce.number().int().positive().default(100),
  MIN_PROVIDER_TRUST: z.coerce.number().int().min(0).max(100).default(50),
  KILL_SWITCH: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    console.error("\n✖ Invalid configuration — refusing to start.\n");
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    console.error("\n  Copy .env.example to .env and fill it in.\n");
    process.exit(1);
  }

  const c = parsed.data;

  // Four DIFFERENT payees is the entire premise of AXIS. If two collide, the
  // atomic group pays the same address twice and the demo proves nothing.
  const payees = [c.PAY_TO_DIFF, c.PAY_TO_GUARDRAIL, c.PAY_TO_ROASTER, c.PAY_TO_BUGSUM];
  if (new Set(payees).size !== payees.length) {
    console.error(
      "\n✖ Provider payout addresses must all be DIFFERENT.\n" +
        "  A multi-payee atomic group that pays one address twice demonstrates nothing.\n",
    );
    process.exit(1);
  }

  return Object.freeze(c);
}
