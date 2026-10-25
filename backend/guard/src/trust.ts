/**
 * Provider trust scores (0–100). Static in v1.
 *
 * The interface is shaped so v2 can compute these from live indexer signals
 * (settlement count, failure rate, refund history) WITHOUT changing any caller.
 * That upgrade is roadmap, not built now.
 */
const STATIC: Record<string, number> = {
  "diff-explainer": 90,
  "guardrail-checker": 95,
  "commit-roaster": 85,
  "bug-summarizer": 88,
};

export function trustScore(provider: string): number {
  return STATIC[provider] ?? 50;
}
