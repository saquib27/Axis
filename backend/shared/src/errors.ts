/**
 * The AXIS error taxonomy.
 *
 * Every failure in the system is one of these codes. Two reasons this matters
 * more than usual here:
 *
 *  1. Money. A caller must be able to tell "this failed and cost you nothing"
 *     from "this failed after settling". That is `costedNothing`, and it is a
 *     property of the code itself so it can never be reported inconsistently.
 *  2. The console renders errors. A typed code maps to a specific animation;
 *     a stack trace maps to nothing.
 */

export const ERROR_CODES = {
  // ── Pre-quote: nothing has left the building ──────────────────────────
  INVALID_WORKFLOW:     { http: 400, costedNothing: true },
  UNKNOWN_STEP_REF:     { http: 400, costedNothing: true },
  DAG_CYCLE:            { http: 400, costedNothing: true },
  MISSING_INPUT:        { http: 400, costedNothing: true },

  // ── Discovery ─────────────────────────────────────────────────────────
  PROVIDER_UNREACHABLE: { http: 502, costedNothing: true },
  CHALLENGE_INVALID:    { http: 502, costedNothing: true },

  // ── Policy gate: rejected BEFORE anything is signed ───────────────────
  POLICY_VIOLATION:     { http: 402, costedNothing: true },
  KILL_SWITCH_ACTIVE:   { http: 403, costedNothing: true },

  // ── Quote lifecycle ───────────────────────────────────────────────────
  QUOTE_EXPIRED:        { http: 410, costedNothing: true },
  QUOTE_CONSUMED:       { http: 409, costedNothing: true },
  QUOTE_NOT_FOUND:      { http: 404, costedNothing: true },
  SIGNATURE_INVALID:    { http: 400, costedNothing: true },

  // ── Compose + pre-flight: still free ──────────────────────────────────
  GROUP_TOO_LARGE:      { http: 400, costedNothing: true },
  NOT_OPTED_IN:         { http: 409, costedNothing: true },
  INSUFFICIENT_BALANCE: { http: 402, costedNothing: true },
  SIMULATION_FAILED:    { http: 409, costedNothing: true },

  // ── Settlement: the boundary. Before this, zero cost. ─────────────────
  SETTLEMENT_FAILED:    { http: 502, costedNothing: true },

  // ── Post-settlement: money HAS moved. Compensation territory. ─────────
  PAYMENT_RECOVERY_REQUIRED: { http: 503, costedNothing: false },
  PROVIDER_TIMEOUT:     { http: 504, costedNothing: false },
  PROVIDER_FAILED:      { http: 502, costedNothing: false },
  COMPENSATION_FAILED:  { http: 500, costedNothing: false },

  // ── Auth (console accounts — never on the money path) ─────────────────
  INVALID_INPUT:        { http: 400, costedNothing: true },
  EMAIL_TAKEN:          { http: 409, costedNothing: true },
  INVALID_CREDENTIALS:  { http: 401, costedNothing: true },
  UNAUTHORIZED:         { http: 401, costedNothing: true },

  // ── Infrastructure ────────────────────────────────────────────────────
  RATE_LIMITED:         { http: 429, costedNothing: true },
  INTERNAL:             { http: 500, costedNothing: true },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AxisError extends Error {
  readonly code: ErrorCode;
  readonly http: number;
  /** True when the agent was charged nothing. Surfaced to the UI verbatim. */
  readonly costedNothing: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AxisError";
    this.code = code;
    this.http = ERROR_CODES[code].http;
    this.costedNothing = ERROR_CODES[code].costedNothing;
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        costedNothing: this.costedNothing,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export const fail = (
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): never => {
  throw new AxisError(code, message, details);
};
