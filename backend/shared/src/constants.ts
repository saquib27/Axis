/**
 * Network + protocol constants.
 *
 * Anything the x402 SDK already exports is RE-EXPORTED here, never retyped.
 * Hardcoding a genesis hash or an asset id by hand is how you ship a demo that
 * silently talks to the wrong network. See docs/PROTOCOL.md §2.
 */
export {
  ALGORAND_MAINNET_CAIP2,
  ALGORAND_TESTNET_CAIP2,
  USDC_MAINNET_ASA_ID,
  USDC_TESTNET_ASA_ID,
  USDC_DECIMALS,
} from "@x402/avm";

/**
 * Algorand caps an atomic group at 16 transactions, and the x402 facilitator
 * enforces the same limit. ONE slot is consumed by the fee-payer transaction,
 * so AXIS may compose at most 15 provider legs. (docs/PROTOCOL.md §4)
 */
export const MAX_GROUP_SIZE = 16;
export const MAX_PROVIDER_LEGS = MAX_GROUP_SIZE - 1;

/** A quote is a price promise. It must expire, or prices go stale. */
export const QUOTE_TTL_SECONDS = 120;

/** Per-provider execution budget, matching the 402 challenge's maxTimeoutSeconds. */
export const PROVIDER_TIMEOUT_MS = 60_000;
export const PROVIDER_MAX_RETRIES = 2;

/** Unpaid discovery probes must be fast — they block the quote response. */
export const PROBE_TIMEOUT_MS = 5_000;

/** AXIS's own fee per workflow run, in microUSDC ($0.01). */
export const ROUTING_FEE_MICRO = 10_000n;

export const ALGORAND_ADDRESS_LENGTH = 58;
