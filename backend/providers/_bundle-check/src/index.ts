/**
 * PHASE 0 GATE — Cloudflare Workers bundling check.
 *
 * Proves the four provider endpoints can actually run on `workerd`: that the
 * x402 server SDK, the AVM scheme and algokit-utils all bundle and import
 * without hitting a Node-only API. If this fails, Phase 2's hosting choice is
 * wrong and we find out now rather than after writing four providers.
 */
import { Hono } from "hono";
import {
  ALGORAND_TESTNET_CAIP2,
  USDC_TESTNET_ASA_ID,
  isValidAlgorandAddress,
} from "@x402/avm";
import { ExactAvmScheme } from "@x402/avm/exact/server";
import { AlgorandClient } from "@algorandfoundation/algokit-utils/algorand-client";

const app = new Hono();

app.get("/", (c) => {
  const scheme = new ExactAvmScheme();
  const algod = AlgorandClient.testNet();
  return c.json({
    ok: true,
    scheme: scheme.scheme,
    network: ALGORAND_TESTNET_CAIP2,
    usdcAsa: USDC_TESTNET_ASA_ID,
    addressValidatorWorks: isValidAlgorandAddress("NOT_AN_ADDRESS") === false,
    algodReachable: typeof algod.account.getInformation === "function",
  });
});

export default app;
