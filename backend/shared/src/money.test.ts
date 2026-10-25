import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseUSDC, formatUSDC, sumUSDC, microUSDC } from "./money.ts";

describe("parseUSDC", () => {
  test("parses the demo prices exactly", () => {
    assert.equal(parseUSDC("0.03"), 30_000n);
    assert.equal(parseUSDC("0.02"), 20_000n);
    assert.equal(parseUSDC("0.05"), 50_000n);
    assert.equal(parseUSDC("0.13"), 130_000n);
  });

  test("accepts $, commas, bare integers and leading dots", () => {
    assert.equal(parseUSDC("$1.50"), 1_500_000n);
    assert.equal(parseUSDC("1,000.00"), 1_000_000_000n);
    assert.equal(parseUSDC("7"), 7_000_000n);
    assert.equal(parseUSDC(".5"), 500_000n);
    assert.equal(parseUSDC(0.25), 250_000n);
  });

  test("pads short fractions correctly", () => {
    assert.equal(parseUSDC("0.1"), 100_000n);
    assert.equal(parseUSDC("0.000001"), 1n);
  });

  test("REJECTS precision USDC cannot hold instead of rounding it away", () => {
    // Silently truncating here would mean quoting a price you cannot charge.
    assert.throws(() => parseUSDC("0.0000001"), RangeError);
  });

  test("rejects junk", () => {
    for (const bad of ["", ".", "abc", "1.2.3", "1e5", "-", "0x10"]) {
      assert.throws(() => parseUSDC(bad), TypeError, `should reject ${JSON.stringify(bad)}`);
    }
  });

  test("rejects negative amounts", () => {
    assert.throws(() => microUSDC(-1n), RangeError);
  });
});

describe("formatUSDC", () => {
  test("round-trips every demo price", () => {
    for (const s of ["0.03", "0.02", "0.05", "0.13", "1.5", "10", "0.000001"]) {
      assert.equal(formatUSDC(parseUSDC(s)), String(Number(s)));
    }
  });

  test("trims trailing zeros but keeps significant digits", () => {
    assert.equal(formatUSDC(130_000n), "0.13");
    assert.equal(formatUSDC(1_000_000n), "1");
    assert.equal(formatUSDC(1n), "0.000001");
    assert.equal(formatUSDC(0n), "0");
  });
});

describe("integer arithmetic — the reason this module exists", () => {
  test("the classic float bug does not exist here", () => {
    // In floating point: 0.1 + 0.2 === 0.30000000000000004
    assert.notEqual(0.1 + 0.2, 0.3);
    // In microUSDC it is exact.
    assert.equal(sumUSDC([parseUSDC("0.1"), parseUSDC("0.2")]), parseUSDC("0.3"));
  });

  test("the workflow total is exact", () => {
    const legs = ["0.03", "0.02", "0.03", "0.05"].map(parseUSDC);
    assert.equal(formatUSDC(sumUSDC(legs)), "0.13");
  });

  test("summing many small amounts never drifts", () => {
    const cent = parseUSDC("0.01");
    const total = sumUSDC(Array.from({ length: 1000 }, () => cent));
    assert.equal(formatUSDC(total), "10");
  });

  test("stays exact at amounts that would lose precision as a float", () => {
    const big = parseUSDC("9007199254.740993"); // beyond Number.MAX_SAFE_INTEGER
    assert.equal(formatUSDC(big), "9007199254.740993");
  });
});
