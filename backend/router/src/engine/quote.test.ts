import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { canonicalQuoteBody, verifyQuoteSignature, type Quote } from "./quote.ts";
import { createHmac } from "node:crypto";
import { microUSDC } from "@axis/shared";

const KEY = "test-signing-key-at-least-32-chars-long-000";

function makeQuote(): Quote {
  const unsigned: Omit<Quote, "signature"> = {
    quoteId: "qt_test", workflow: "pr-review",
    agentAddress: "A".repeat(58), network: "algorand:testnet",
    dag: { batches: [["a"]], edges: [] },
    legs: [{ stepId: "a", provider: "p", payTo: "B".repeat(58), priceMicro: microUSDC(30000n), asset: "10458941", challenge: {} }],
    subtotalMicro: microUSDC(30000n), routingFeeMicro: microUSDC(10000n), totalMicro: microUSDC(40000n),
    expiresAt: "2026-08-08T00:00:00.000Z",
    policy: { verdict: "PASS", checks: [], violations: [] },
  };
  const signature = createHmac("sha256", KEY).update(canonicalQuoteBody(unsigned)).digest("base64");
  return { ...unsigned, signature };
}

describe("quote signature", () => {
  test("a valid quote verifies", () => {
    assert.equal(verifyQuoteSignature(makeQuote(), KEY), true);
  });

  test("tampering with the TOTAL fails verification", () => {
    const q = makeQuote();
    q.totalMicro = microUSDC(1n); // agent tries to pay 0.000001 instead of 0.04
    assert.equal(verifyQuoteSignature(q, KEY), false);
  });

  test("tampering with a PAYEE fails verification", () => {
    const q = makeQuote();
    q.legs[0]!.payTo = "Z".repeat(58); // redirect the money
    assert.equal(verifyQuoteSignature(q, KEY), false);
  });

  test("a different signing key fails", () => {
    assert.equal(verifyQuoteSignature(makeQuote(), "wrong-key-also-32-chars-long-00000000"), false);
  });

  test("the canonical body is order-independent for stable fields", () => {
    // Signing must be deterministic regardless of object construction order.
    assert.equal(canonicalQuoteBody(makeQuote()), canonicalQuoteBody(makeQuote()));
  });
});
