/**
 * The spend policy — the gate that runs BEFORE any signature.
 * A FAIL here means no group is ever built, so a violation costs exactly zero.
 */
import { z } from "zod";

export const zSpendPolicy = z.object({
  agentAddress: z.string(),
  maxWorkflowMicro: z.bigint(),
  maxProviderMicro: z.bigint(),
  maxHourlySpendMicro: z.bigint(),
  maxHourlyCalls: z.number().int().positive(),
  minProviderTrust: z.number().int().min(0).max(100),
  killSwitch: z.boolean(),
});

/** Returned for EVERY rule, passed or failed — the console draws headroom bars. */
export const zPolicyCheck = z.object({
  rule: z.enum([
    "killSwitch",
    "maxWorkflowSpend",
    "maxProviderSpend",
    "hourlySpendLimit",
    "hourlyCallLimit",
    "providerTrust",
  ]),
  passed: z.boolean(),
  limitUSDC: z.string().optional(),
  actualUSDC: z.string().optional(),
  headroomUSDC: z.string().optional(),
  detail: z.string().optional(),
});

export const zPolicyVerdict = z.object({
  verdict: z.enum(["PASS", "FAIL"]),
  checks: z.array(zPolicyCheck),
  violations: z.array(z.string()),
});

export type SpendPolicy = z.infer<typeof zSpendPolicy>;
export type PolicyCheck = z.infer<typeof zPolicyCheck>;
export type PolicyVerdict = z.infer<typeof zPolicyVerdict>;
