# Project-scoped read API

Published and verified on live preview: `GET /api/costs/projects/{slug}/ledger?month=YYYY-MM`. No iTrader reader/writer cutover is enabled.

Configure server-only `COSTS_PROJECT_READ_TOKEN_SHA256_BY_SLUG` as a JSON object whose keys are exact project slugs and values are distinct lowercase SHA-256 hex digests of strong, randomly generated bearer tokens. Keep plaintext read credentials only in the consuming application's secret store. Send the credential in `Authorization: Bearer …`, never a query parameter. Ingest credentials and administrator sessions do not grant this endpoint access. Missing/malformed configuration fails closed.

The route resolves the authorized slug server-side and ignores query parameters that try to select another project. Responses use `private, no-store`, contain minimized monthly rows and native-currency totals, omit account/conversation/workspace/client identifiers and source evidence, and explicitly state `provisional-estimates` with `approvedSnapshot: false`. They must not be used as an approved invoice basis. Unknown monetary values remain null; held lines are marked `review-required`. The existing 50,000-event monthly limit applies. No writes are supported.

Local verification used a separate development-only iTrader read credential. It reproduced independently reconciled sample event counts and precise totals. Missing credentials, the ingest token and access to another project returned 401; POST returned 405; invalid month returned 400. Extra project query parameters could not change the scope. Dedicated auth and response-minimization tests passed.

Before iTrader/invoicing cutover: freeze approved charge snapshots, reconcile historical source/invoice/settlement identities, test unavailable/stale data behavior in the iTrader reader, repeat the hosted contract checks against the eventual production configuration. Then follow the one-writer cutover gates in `cutover-plan.md`.

Hosted verification on 28 September: the dedicated iTrader read credential reproduced the reconciled sample; cross-project, missing/ingest credentials and writes were rejected. Deployment is documented in `preview-verification.md`.
