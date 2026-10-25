/** What a caller submits: a set of steps, some consuming others' output. */
import { z } from "zod";
import { MAX_PROVIDER_LEGS, ALGORAND_ADDRESS_LENGTH } from "../constants.ts";

export const zAlgorandAddress = z
  .string()
  .length(ALGORAND_ADDRESS_LENGTH, "Algorand addresses are 58 characters");

export const zStepId = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/, "step ids may contain only letters, digits, _ and -");

export const zWorkflowStep = z.object({
  id: zStepId,
  provider: z.string().min(1),
  /** Values may embed ${inputs.x} and ${steps.a.output.b} references. */
  input: z.record(z.unknown()).default({}),
});

export const zWorkflowSpec = z.object({
  id: z.string().min(1),
  steps: z
    .array(zWorkflowStep)
    .min(1, "a workflow needs at least one step")
    // One transaction per leg, and one group slot is the fee payer.
    .max(MAX_PROVIDER_LEGS, `at most ${MAX_PROVIDER_LEGS} steps per workflow`),
});

export const zQuoteRequest = z.object({
  workflow: z.string().min(1),
  agentAddress: zAlgorandAddress,
  inputs: z.record(z.unknown()).default({}),
  constraints: z
    .object({
      /** Tightens the stored policy ceiling; can never loosen it. */
      maxSpendUSDC: z.string().optional(),
    })
    .optional(),
});

export type WorkflowSpec = z.infer<typeof zWorkflowSpec>;
export type QuoteRequest = z.infer<typeof zQuoteRequest>;
