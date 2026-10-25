/**
 * The Spend Policy Guard. Phase 6.
 *
 * Runs BETWEEN quote and compose — a FAIL means no group is ever built, so a
 * violation costs the agent exactly zero. This is the Agent Infrastructure
 * sub-track, folded in as a mandatory pre-signature gate rather than a bolt-on
 * advisory API.
 *
 * Pure logic. The ONLY input beyond the quote and policy is a spend-history
 * snapshot (the rolling velocity window), passed in so this function stays
 * testable with no I/O.
 */
import { formatUSDC, microUSDC, type MicroUSDC } from "@axis/shared";

export interface SpendPolicy {
  maxWorkflowMicro: bigint;
  maxProviderMicro: bigint;
  maxHourlySpendMicro: bigint;
  maxHourlyCalls: number;
  minProviderTrust: number;
  killSwitch: boolean;
}

export interface SpendHistory {
  /** microUSDC spent by this agent in the last rolling hour. */
  spentLastHourMicro: bigint;
  /** provider calls by this agent in the last rolling hour. */
  callsLastHour: number;
}

export interface QuoteForPolicy {
  grandTotalMicro: bigint;
  legs: { provider: string; priceMicro: bigint; trustScore: number }[];
  /** The client's own tighter ceiling, if any — can only tighten, never loosen. */
  clientMaxMicro?: bigint;
}

export type Rule =
  | "killSwitch" | "maxWorkflowSpend" | "maxProviderSpend"
  | "hourlySpendLimit" | "hourlyCallLimit" | "providerTrust";

export interface PolicyCheck {
  rule: Rule;
  passed: boolean;
  limitUSDC?: string;
  actualUSDC?: string;
  headroomUSDC?: string;
  detail?: string;
}

export interface PolicyVerdict {
  verdict: "PASS" | "FAIL";
  checks: PolicyCheck[];
  violations: string[];
}

const money = (limit: bigint, actual: bigint) => ({
  limitUSDC: formatUSDC(microUSDC(limit)),
  actualUSDC: formatUSDC(microUSDC(actual < 0n ? 0n : actual)),
  headroomUSDC: formatUSDC(microUSDC(limit > actual ? limit - actual : 0n)),
});

/**
 * Evaluate all six rules. Returns EVERY check, passed or failed, WITH headroom —
 * the console renders these as live budget bars, so showing the guard passing is
 * as valuable as showing it block.
 */
export function evaluate(
  quote: QuoteForPolicy, policy: SpendPolicy, history: SpendHistory,
): PolicyVerdict {
  const checks: PolicyCheck[] = [];

  // 1. Kill switch — an immediate global stop.
  checks.push({ rule: "killSwitch", passed: !policy.killSwitch,
    ...(policy.killSwitch ? { detail: "kill switch is active" } : {}) });

  // The client's constraint can only make the ceiling TIGHTER, never looser.
  const workflowCeiling = quote.clientMaxMicro != null
    ? (quote.clientMaxMicro < policy.maxWorkflowMicro ? quote.clientMaxMicro : policy.maxWorkflowMicro)
    : policy.maxWorkflowMicro;

  // 2. Per-workflow ceiling.
  checks.push({ rule: "maxWorkflowSpend",
    passed: quote.grandTotalMicro <= workflowCeiling,
    ...money(workflowCeiling, quote.grandTotalMicro) });

  // 3. Per-provider cap — every leg must be under it.
  const priciest = quote.legs.reduce((m, l) => (l.priceMicro > m ? l.priceMicro : m), 0n);
  checks.push({ rule: "maxProviderSpend",
    passed: priciest <= policy.maxProviderMicro,
    ...money(policy.maxProviderMicro, priciest) });

  // 4. Rolling hourly spend velocity.
  const projectedSpend = history.spentLastHourMicro + quote.grandTotalMicro;
  checks.push({ rule: "hourlySpendLimit",
    passed: projectedSpend <= policy.maxHourlySpendMicro,
    ...money(policy.maxHourlySpendMicro, projectedSpend) });

  // 5. Rolling hourly call velocity.
  const projectedCalls = history.callsLastHour + quote.legs.length;
  checks.push({ rule: "hourlyCallLimit",
    passed: projectedCalls <= policy.maxHourlyCalls,
    limitUSDC: String(policy.maxHourlyCalls), actualUSDC: String(projectedCalls),
    headroomUSDC: String(Math.max(0, policy.maxHourlyCalls - projectedCalls)) });

  // 6. Provider trust threshold.
  const lowest = quote.legs.reduce((m, l) => Math.min(m, l.trustScore), 100);
  const distrusted = quote.legs.filter((l) => l.trustScore < policy.minProviderTrust);
  checks.push({ rule: "providerTrust", passed: distrusted.length === 0,
    limitUSDC: String(policy.minProviderTrust), actualUSDC: String(lowest),
    ...(distrusted.length ? { detail: `${distrusted.map((l) => l.provider).join(", ")} below trust ${policy.minProviderTrust}` } : {}) });

  const failed = checks.filter((c) => !c.passed);
  return {
    verdict: failed.length === 0 ? "PASS" : "FAIL",
    checks,
    violations: failed.map((c) => c.detail ?? `${c.rule}: ${c.actualUSDC} exceeds ${c.limitUSDC}`),
  };
}

export const DEFAULT_POLICY: SpendPolicy = {
  maxWorkflowMicro: 1_000_000n,   // $1.00
  maxProviderMicro: 500_000n,     // $0.50
  maxHourlySpendMicro: 10_000_000n, // $10.00
  maxHourlyCalls: 100,
  minProviderTrust: 50,
  killSwitch: false,
};
