/**
 * Shared helpers for the AXIS Phase 0 scripts.
 *
 * Constants are IMPORTED from @x402/avm rather than hardcoded — see docs/PROTOCOL.md §2.
 * The CAIP-2 network id is a genesis-hash string, not "algorand:testnet".
 */
import { config as loadEnv } from "dotenv";
import { AlgorandClient } from "@algorandfoundation/algokit-utils/algorand-client";
import {
  ALGORAND_TESTNET_CAIP2,
  USDC_TESTNET_ASA_ID,
  USDC_DECIMALS,
} from "@x402/avm";

loadEnv({ path: ".env.accounts", quiet: true });
loadEnv({ quiet: true });

export const NETWORK_CAIP2 = ALGORAND_TESTNET_CAIP2;
export const USDC_ASA_ID = BigInt(USDC_TESTNET_ASA_ID);
export const DECIMALS = USDC_DECIMALS;

/** The four provider payees, in group order. */
export const PROVIDERS = [
  { key: "DIFF", name: "diff-explainer", priceUSDC: "0.03" },
  { key: "GUARDRAIL", name: "guardrail-checker", priceUSDC: "0.02" },
  { key: "ROASTER", name: "commit-roaster", priceUSDC: "0.03" },
  { key: "BUGSUM", name: "bug-summarizer", priceUSDC: "0.05" },
] as const;

export const algorand = () => AlgorandClient.testNet();

/** "0.03" -> 30000n  (integer microUSDC only — never floats). */
export function toMicro(usdc: string): bigint {
  const [whole, frac = ""] = usdc.trim().replace(/^\$/, "").split(".");
  if (frac.length > DECIMALS) throw new Error(`too many decimals: ${usdc}`);
  return BigInt(whole) * 10n ** BigInt(DECIMALS) + BigInt(frac.padEnd(DECIMALS, "0") || "0");
}

/** 30000n -> "0.030000" */
export function fromMicro(micro: bigint): string {
  const s = micro.toString().padStart(DECIMALS + 1, "0");
  return `${s.slice(0, -DECIMALS)}.${s.slice(-DECIMALS)}`;
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`\n✖ Missing ${name}\n  Run: pnpm accounts:new   (then fund the agent)\n`);
    process.exit(1);
  }
  return v;
}

export const explorerTx = (id: string) => `https://lora.algokit.io/testnet/transaction/${id}`;
export const explorerAcct = (a: string) => `https://lora.algokit.io/testnet/account/${a}`;

export const hr = (t = "") =>
  console.log(`\n${"─".repeat(72)}${t ? `\n${t}` : ""}`);
