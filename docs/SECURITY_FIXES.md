# Payment and account safety changes

Apply `0007_quote_ownership` before starting the updated router. From `backend/router`, run `pnpm db:migrate` against the intended database. No deployment database was modified while implementing these changes.

All private `/v1` endpoints require an existing account API key. Quote ownership is persisted and checked before execution. The router accepts only quotes for its configured payer wallet. Receipt detail and SSE streams enforce account ownership; the console, SDK and extension pass credentials for these reads. Historical open quotes without ownership must be quoted again.

Direct-payment `/v1/redteam/*` demonstrations now return 403. They intentionally remain disabled because they bypass policy checks and the payment ledger. The attack page cannot run these demos until they are implemented through the guarded workflow path.

Execution takes a PostgreSQL transaction advisory lock for the payer, rechecks current policy and project ownership/budget, atomically claims the quote, and reserves per-leg spend before releasing the lock. Pending and uncertain payments continue to reserve hourly and project headroom, including when they are older than one hour. Explicit agent budgets can only tighten project headroom. Pre-submission failures release the reservation.

The composer is built before simulation so simulation and submission use the same transactions. Their IDs are persisted before sending. Submission or later processing failures produce `RECOVERY_REQUIRED` and `costedNothing: false`; clients must not create a new payment to retry. Agent error handling preserves the existing payment record.

On startup, reconciliation checks saved transaction IDs through the configured indexer. Confirmed payments become SETTLED only when every provider result was durably delivered; otherwise they become PARTIAL with a delivery-interrupted error. Existing results and compensation IDs are retained. Providers and refunds are not automatically replayed because their responses may have been lost after a successful operation.

If transaction confirmation is unknown, or a crash occurred before transaction IDs were persisted, the reservation is deliberately retained. An operator must establish the on-chain outcome before releasing it or retrying delivery. Reconciliation cannot reconstruct transaction IDs that the old implementation never saved. No automatic additional payments are made during recovery.

Validation includes backend/frontend TypeScript checks and security regression tests with mocked chain/database boundaries. A live PostgreSQL concurrency test and a funded on-chain settlement were not run. Use a Node runtime with native TypeScript support (the bundled Node 24 runtime was used for tests).
