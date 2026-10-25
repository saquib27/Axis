/**
 * The demo workflow: a full code-change review.
 *
 * Four steps. `bugsum` consumes `diff`'s output, so the DAG is real — three run
 * in parallel, then one. All four providers are on distinct payout addresses,
 * which is what makes the atomic group genuinely multi-payee.
 */
import type { WorkflowStep } from "@axis/shared";

export interface WorkflowDef {
  id: string;
  steps: (WorkflowStep & { endpointEnv: string; path: string })[];
}

export const PR_REVIEW: WorkflowDef = {
  id: "pr-review",
  steps: [
    {
      id: "diff",
      provider: "diff-explainer",
      endpointEnv: "PROVIDER_DIFF_URL",
      path: "/diff/explain",
      input: { diff: "${inputs.diff}" },
    },
    {
      id: "guardrail",
      provider: "guardrail-checker",
      endpointEnv: "PROVIDER_GUARDRAIL_URL",
      path: "/guardrail/check",
      input: { text: "${inputs.diff}" },
    },
    {
      id: "roast",
      provider: "commit-roaster",
      endpointEnv: "PROVIDER_ROASTER_URL",
      path: "/commit/roast",
      input: { message: "${inputs.commitMessage}" },
    },
    {
      id: "bugsum",
      provider: "bug-summarizer",
      endpointEnv: "PROVIDER_BUGSUM_URL",
      path: "/bug/summarize",
      // Real dependency: consumes diff's output → runs in batch 1.
      input: { report: "${steps.diff.output.summary}" },
    },
  ],
};

/** Just the safety check — "is this code/text safe to ship?" (cheapest). */
export const SECURITY_SCAN: WorkflowDef = {
  id: "security-scan",
  steps: [
    {
      id: "guardrail",
      provider: "guardrail-checker",
      endpointEnv: "PROVIDER_GUARDRAIL_URL",
      path: "/guardrail/check",
      input: { text: "${inputs.text}" },
    },
  ],
};

/** Explain a change, then hunt for bugs in it — two providers, a real dependency. */
export const BUG_HUNT: WorkflowDef = {
  id: "bug-hunt",
  steps: [
    {
      id: "diff",
      provider: "diff-explainer",
      endpointEnv: "PROVIDER_DIFF_URL",
      path: "/diff/explain",
      input: { diff: "${inputs.diff}" },
    },
    {
      id: "bugsum",
      provider: "bug-summarizer",
      endpointEnv: "PROVIDER_BUGSUM_URL",
      path: "/bug/summarize",
      input: { report: "${steps.diff.output.summary}" },
    },
  ],
};

/** Improve a commit message — one provider. */
export const COMMIT_POLISH: WorkflowDef = {
  id: "commit-polish",
  steps: [
    {
      id: "roast",
      provider: "commit-roaster",
      endpointEnv: "PROVIDER_ROASTER_URL",
      path: "/commit/roast",
      input: { message: "${inputs.commitMessage}" },
    },
  ],
};

/** A single-step workflow that calls one toolbox service (its own distinct payee). */
const toolbox = (id: string, provider: string, path: string, input: Record<string, string>): WorkflowDef => ({
  id,
  steps: [{ id: "tool", provider, endpointEnv: "PROVIDER_TOOLBOX_URL", path, input }],
});

/** The 5 toolbox services, each as its own workflow. */
export const GENERATE_CODE = toolbox("generate-code", "code-generator", "/code/generate", { task: "${inputs.task}" });
export const DEBUG_ERROR = toolbox("debug-error", "debugger", "/debug/fix", { error: "${inputs.error}" });
export const WRITE_TESTS = toolbox("write-tests", "test-writer", "/test/write", { code: "${inputs.code}" });
export const TRANSLATE_TEXT = toolbox("translate-text", "translator", "/translate", { text: "${inputs.text}", language: "${inputs.language}" });
export const SUMMARIZE_TEXT = toolbox("summarize-text", "summarizer", "/summarize", { text: "${inputs.text}" });

/**
 * DEEP REVIEW — the flagship BIGGER atomic group. EVERY provider AXIS knows,
 * nine DISTINCT payees, all running at once on one change: explain,
 * safety-check, commit critique, bug hunt, TL;DR, tests, a suggested
 * implementation, a debug pass, and a plain-English translation. One
 * signature, all-or-nothing, and any provider that fails to deliver is refunded
 * on chain. No step depends on another, so every leg runs simultaneously.
 *
 * Nine legs plus the facilitator's fee payer is 10 of Algorand's 16-slot group
 * limit — the group stays valid with room to spare.
 */
export const DEEP_REVIEW: WorkflowDef = {
  id: "deep-review",
  steps: [
    { id: "diff", provider: "diff-explainer", endpointEnv: "PROVIDER_DIFF_URL", path: "/diff/explain", input: { diff: "${inputs.diff}" } },
    { id: "guardrail", provider: "guardrail-checker", endpointEnv: "PROVIDER_GUARDRAIL_URL", path: "/guardrail/check", input: { text: "${inputs.diff}" } },
    { id: "roast", provider: "commit-roaster", endpointEnv: "PROVIDER_ROASTER_URL", path: "/commit/roast", input: { message: "${inputs.commitMessage}" } },
    { id: "bugsum", provider: "bug-summarizer", endpointEnv: "PROVIDER_BUGSUM_URL", path: "/bug/summarize", input: { report: "${inputs.diff}" } },
    { id: "summary", provider: "summarizer", endpointEnv: "PROVIDER_TOOLBOX_URL", path: "/summarize", input: { text: "${inputs.diff}" } },
    { id: "tests", provider: "test-writer", endpointEnv: "PROVIDER_TOOLBOX_URL", path: "/test/write", input: { code: "${inputs.diff}" } },
    { id: "suggest", provider: "code-generator", endpointEnv: "PROVIDER_TOOLBOX_URL", path: "/code/generate", input: { task: "${inputs.diff}" } },
    { id: "debug", provider: "debugger", endpointEnv: "PROVIDER_TOOLBOX_URL", path: "/debug/fix", input: { error: "${inputs.diff}" } },
    { id: "translate", provider: "translator", endpointEnv: "PROVIDER_TOOLBOX_URL", path: "/translate", input: { text: "${inputs.diff}", language: "plain English" } },
  ],
};

export const WORKFLOWS: Record<string, WorkflowDef> = {
  "deep-review": DEEP_REVIEW,
  "pr-review": PR_REVIEW,
  "security-scan": SECURITY_SCAN,
  "bug-hunt": BUG_HUNT,
  "commit-polish": COMMIT_POLISH,
  "generate-code": GENERATE_CODE,
  "debug-error": DEBUG_ERROR,
  "write-tests": WRITE_TESTS,
  "translate-text": TRANSLATE_TEXT,
  "summarize-text": SUMMARIZE_TEXT,
};
