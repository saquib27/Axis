# AXIS — Protocol Facts (verified against the real SDKs)

> Everything in this file was **read out of the installed packages**, not assumed.
> Verified 2026-08-07 against `@x402/*` **2.21.0**.
> `ARCHITECTURE.md` and `BUILD_PLAN.md` defer to this file wherever they disagree.

## 1. Confirmed packages

The track brief's names are correct. The hyphenated `@x402-avm/*` scope referenced in
the original README **does not apply** — do not use it.

| Package | Version | Role |
|---|---|---|
| `@x402/core` | 2.21.0 | Shared types, schemas. Depends on **`zod ^3.24.2`** |
| `@x402/avm` | 2.21.0 | Algorand scheme — client / server / facilitator |
| `@x402/fetch` | 2.21.0 | Client auto-sign + retry wrapper |
| `@x402/hono` | 2.21.0 | Server 402 middleware. Peers: `hono ^4`, `@x402/paywall ^2.21.0` |
| `@algorandfoundation/algokit-utils` | **10.0.0-alpha.46** | Pulled in by `@x402/avm`. Pin exactly — it is an alpha. |

> ⚠️ **Use `zod@^3.24.2`, not v4.** `@x402/core` builds its schemas on zod 3. Installing
> zod 4 alongside produces two zod copies and incompatible inferred types at the boundary.

## 2. Confirmed constants (exported by `@x402/avm`)

```ts
ALGORAND_MAINNET_CAIP2   = "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k"
ALGORAND_TESTNET_CAIP2   = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe"

ALGORAND_MAINNET_GENESIS_HASH = "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8="
ALGORAND_TESTNET_GENESIS_HASH = "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI="

USDC_MAINNET_ASA_ID = "31566704"
USDC_TESTNET_ASA_ID = "10458941"
USDC_DECIMALS       = 6

MAX_REASONABLE_FEE_PER_TXN = 5000            // µAlgo
maxReasonableGroupFee(n)   = 5000 * n        // fee-payer cap for a group of n
```

> ⚠️ **`NETWORK=algorand:testnet` is not a real identifier.** The CAIP-2 id is the
> genesis-hash form above. Import the constant; never hand-write it.
> Do not hardcode the ASA id either — import `USDC_TESTNET_ASA_ID`.

## 3. The payload shape — and why AXIS works

```ts
interface ExactAvmPayloadV2 {
  paymentGroup: string[]  // base64 msgpack txns forming ONE atomic group (max 16)
  paymentIndex: number    // zero-based index of THIS payment within the group
}
```

`paymentIndex` is **singular**. A naive reading says "one payment per group, so
multi-payee is impossible." That reading is wrong, and the facilitator source settles it.

**Facilitator `verify(payload, requirements)` does:**
1. Validate `x402Version`, scheme, network
2. Validate payload structure
3. **Reject if group size > 16**
4. `decodeTransactionGroup` — signed txns decoded as-is; **unsigned txns accepted only
   from facilitator addresses** (fee payers); **group id must be consistent across all txns**
5. **Verify only the txn at `paymentIndex`** against `requirements` (amount / receiver / asset)
6. Verify fee-payer safety, then sign it
7. **Simulate the whole group**

**Facilitator `settle(payload, requirements)` does:**
1. `verify` first
2. Sign fee-payer txns
3. **Submit the entire group**
4. Wait for confirmation
5. Return the transaction id

### The consequence

Nothing constrains the *other* transactions in the group beyond: signed by someone,
same group id, and the group must simulate cleanly. So:

```
ONE atomic group, built once by the AXIS router:

  index 0  fee payer txn        (unsigned — facilitator signs it)
  index 1  USDC → provider A    signed by agent
  index 2  USDC → provider B    signed by agent
  index 3  USDC → provider C    signed by agent
  index 4  USDC → provider D    signed by agent

Provider A is handed { paymentGroup: <all 5>, paymentIndex: 1 }
Provider B is handed { paymentGroup: <all 5>, paymentIndex: 2 }   ← same group
Provider C is handed { paymentGroup: <all 5>, paymentIndex: 3 }
Provider D is handed { paymentGroup: <all 5>, paymentIndex: 4 }
```

Each provider verifies **its own leg** through the facilitator. The group settles **once**,
atomically, and every leg lands or none does. **This is the AXIS thesis, and the SDK
supports it natively.**

### Orchestration rule (important)

`settle()` submits the whole group, so **only one party may call settle**. The router
verifies with every provider, then settles exactly once, then presents proof to each
provider for the paid retry. Letting four providers each call `settle()` races four
submissions of the same group — first wins, rest error.

## 4. Group budget — corrected

Facilitator hard cap is **16 transactions**. One slot is the fee payer.

**→ Maximum provider legs per group is 15, not 16.**

`MAX_GROUP_SIZE = 16` stays as the chain/facilitator constant, but the router asserts
`legs.length <= 15` and shards above that.

## 5. Facilitator error codes (for typed mapping)

`invalid_exact_avm_` + `scheme` · `network_mismatch` · `invalid_version` · `payload` ·
`group_size_exceeded` · `payment_index` · `invalid_transaction` · `invalid_group_id` ·
`not_asset_transfer` · `amount_mismatch` · `receiver_mismatch` · `asset_mismatch` ·
`invalid_fee_payer` · `fee_too_high` · `payment_not_signed` · `invalid_signature` ·
`simulation_failed` · `facilitator_transferring` · `unsigned_non_facilitator` ·
`settlement_failed` · `confirmation_failed`

Import as `Errors` from `@x402/avm/exact/facilitator` — do not retype the strings.

## 6. Class map

| Import | Class | Used by |
|---|---|---|
| `@x402/avm/exact/client` | `ExactAvmScheme` | Router — `createPaymentPayload()` |
| `@x402/avm/exact/server` | `ExactAvmScheme` | Providers — `parsePrice()`, `enhancePaymentRequirements()` |
| `@x402/avm/exact/facilitator` | `ExactAvmScheme` | GoPlausible-hosted; we call it over HTTP |

Signer helpers from `@x402/avm`: `getAlgokitSigner`, `toClientAvmSigner`,
`toFacilitatorAvmSigner`, `isAvmSignerWallet`, `ALGOKIT_SIGNER`.

Useful utils: `encodeTransaction`, `decodeTransaction`, `decodeSignedTransaction`,
`decodeUnsignedTransaction`, `getTransactionId`, `validateGroupId`, `hasSignature`,
`getSenderFromTransaction`, `isValidAlgorandAddress`, `normalizeAlgorandNetwork`,
`convertToTokenAmount`, `convertFromTokenAmount`.

## 7. Open questions for the spike

- [ ] Does the hosted facilitator accept a group where legs pay **different** `payTo`
      addresses than the one in `requirements`? (Reading says yes — only `paymentIndex`
      is checked — but this must be **proven**, it is the load-bearing assumption.)
- [ ] Exact fee-payer construction: does `ExactAvmScheme.createPaymentPayload` build the
      whole group, or do we compose manually with `TransactionComposer` and only borrow
      its encoding helpers?
- [ ] Does `verify()` on leg 2 still succeed **after** the group is already committed
      on chain, or must all verifies precede the single settle?

## 8. Cloudflare Workers bundling — VERIFIED

Phase 0 gate item. `wrangler deploy --dry-run` on a Worker importing `hono`,
`@x402/hono`, `@x402/avm`, `@x402/avm/exact/server` and
`@algorandfoundation/algokit-utils/algorand-client`:

```
Total Upload: 1588.80 KiB / gzip: 293.16 KiB
```

Bundles cleanly on `workerd` with `compatibility_flags = ["nodejs_compat"]`.
293 KB gzipped is well inside the Workers size limit, so the four providers can
host there as planned. Source: `backend/providers/_bundle-check/`.
