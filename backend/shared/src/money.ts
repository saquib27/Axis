/**
 * Money. Integer microUSDC, always.
 *
 * USDC has 6 decimals, so $0.13 is 130000 microUSDC. Every amount in AXIS is a
 * `bigint` in those units. Floats are unrepresentable here BY CONSTRUCTION —
 * `0.1 + 0.2 !== 0.3` is not a bug you get to have in a payments system.
 *
 * The branded type means a raw `bigint` will not type-check where MicroUSDC is
 * expected: you must go through parseUSDC or microUSDC, both of which validate.
 */
import { z } from "zod";
import { USDC_DECIMALS } from "./constants.ts";

declare const brand: unique symbol;
export type MicroUSDC = bigint & { readonly [brand]: "MicroUSDC" };

const SCALE = 10n ** BigInt(USDC_DECIMALS);

/** Assert a bigint is a valid non-negative amount and brand it. */
export function microUSDC(v: bigint): MicroUSDC {
  if (v < 0n) throw new RangeError(`amount cannot be negative: ${v}`);
  return v as MicroUSDC;
}

/**
 * Parse a decimal string to microUSDC. Accepts "0.13", "$0.13", ".13", "1".
 * Rejects anything with more precision than USDC can represent, rather than
 * silently rounding it away.
 */
export function parseUSDC(input: string | number): MicroUSDC {
  const s = String(input).trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") {
    throw new TypeError(`not a valid USDC amount: ${JSON.stringify(input)}`);
  }
  const [whole = "0", frac = ""] = s.split(".");
  if (frac.length > USDC_DECIMALS) {
    throw new RangeError(
      `${s} has ${frac.length} decimals; USDC supports ${USDC_DECIMALS}`,
    );
  }
  const w = whole === "" ? 0n : BigInt(whole);
  const f = frac === "" ? 0n : BigInt(frac.padEnd(USDC_DECIMALS, "0"));
  return microUSDC(w * SCALE + f);
}

/** Render for display only: 130000n -> "0.13". Never feed this back into math. */
export function formatUSDC(v: MicroUSDC | bigint): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const s = abs.toString().padStart(USDC_DECIMALS + 1, "0");
  const whole = s.slice(0, -USDC_DECIMALS);
  const frac = s.slice(-USDC_DECIMALS).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function sumUSDC(amounts: readonly (MicroUSDC | bigint)[]): MicroUSDC {
  return microUSDC(amounts.reduce<bigint>((a, b) => a + b, 0n));
}

/**
 * Zod schema for a wire-format amount. Amounts cross the network as decimal
 * STRINGS ("0.13") because JSON numbers cannot hold a bigint safely, and parse
 * back to branded microUSDC on the way in.
 */
export const zUSDC = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    try {
      return parseUSDC(v);
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message });
      return z.NEVER;
    }
  });
