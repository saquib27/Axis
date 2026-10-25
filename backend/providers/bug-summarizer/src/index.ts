/** POST /bug/summarize — $0.05 — noisy bug report to repro steps + severity. */
import { Hono } from "hono";
import { z } from "zod";
import { paidHandler, ClaimDO, jsonComplete, type ProviderConfig, type ProviderEnv } from "@axis/provider-kit";

const cfg: ProviderConfig = {
  name: "bug-summarizer",
  priceUSDC: "0.05",
  description: "Turn a noisy bug report into reproducible steps and a severity",
  payToEnvKey: "PAY_TO_BUGSUM",
};

const Input = z.object({ report: z.string().min(1, "report is required") });

const Output = z.object({
  title: z.string(),
  // Cap at 3: the model happily writes 6-8 steps, and that array is the main
  // token sink and latency driver. Three concrete steps is plenty for a repro.
  steps: z.array(z.string()).min(1).max(3),
  expected: z.string(),
  actual: z.string(),
  // Models return "High" as readily as "high". Normalise BEFORE the enum
  // rather than failing validation and burning a corrective retry on casing.
  severity: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.enum(["low", "medium", "high", "critical"])),
});

const SYSTEM = `You turn messy bug reports into something an engineer can act on.
Return JSON: { "title": string, "steps": string[], "expected": string,
"actual": string, "severity": "low"|"medium"|"high"|"critical" }.
Give AT MOST 3 concrete, ordered steps. Keep every field terse. If the report
omits something, infer the most likely case rather than padding.`;

const app = new Hono();
app.get("/health", (c) => c.json({ provider: cfg.name, priceUSDC: cfg.priceUSDC, payTo: (c.env as ProviderEnv)[cfg.payToEnvKey] ?? null }));
app.post("/bug/summarize", (c) =>
  paidHandler(c, {
    cfg,
    input: Input,
    run: ({ report }, env) => jsonComplete(env, Output, SYSTEM, report, 350),
  }),
);
export default app;

export { ClaimDO };
