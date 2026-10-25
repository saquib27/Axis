/** POST /diff/explain — $0.03 — plain-language explanation of a git diff. */
import { Hono } from "hono";
import { z } from "zod";
import { paidHandler, ClaimDO, complete, type ProviderConfig, type ProviderEnv } from "@axis/provider-kit";

const cfg: ProviderConfig = {
  name: "diff-explainer",
  priceUSDC: "0.03",
  description: "Plain-language explanation of a git diff",
  payToEnvKey: "PAY_TO_DIFF",
};

const Input = z.object({ diff: z.string().min(1, "diff is required") });

const SYSTEM = `You explain git diffs to a reviewer who has not seen the code.
State what changed and why it matters in 2-4 sentences. Lead with the effect on
behaviour, not a file-by-file walk. No preamble, no markdown headers.`;

const app = new Hono();
app.get("/health", (c) => c.json({ provider: cfg.name, priceUSDC: cfg.priceUSDC, payTo: (c.env as ProviderEnv)[cfg.payToEnvKey] ?? null }));
app.post("/diff/explain", (c) =>
  paidHandler(c, {
    cfg,
    input: Input,
    run: async ({ diff }, env) => ({ summary: await complete(env, SYSTEM, diff, 400) }),
  }),
);
export default app;

export { ClaimDO };
