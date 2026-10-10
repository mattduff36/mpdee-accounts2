# Global client pricing

This note describes the current Accounts calculation and the read-only project summary. It does not record a release, a production cutover, or a completed check against live data.

## Universal charge rule

Client charge amounts follow `CHARGE_RULE_VERSION` (`mpdee-global-client-charge-v1` in `src/lib/costs/money.ts`):

- Included premium Cursor usage is 50% of nominal units.
- Included Grok and Composer usage is 0%. Those rows stay included usage. They are not deleted evidence and they are not free funding.
- All on-demand Cursor usage is 100% of recorded provider cash, for every model.
- Eligible infrastructure (Vercel, Supabase, and manual infrastructure funding) is face value.
- There is no markup and no daily membership in this charge.
- GBP uses a dated rate for each event. A rate stored on the event wins. Reference rates are estimates, not bank-settled GBP. A missing rate stays unavailable (`null` pence, with the missing-row count kept explicit).

`COMPARISON_POLICY_VERSION` (`mpdee-comparison-policy-v1`) is the existing comparison wire label. It does not version the amounts. Amounts follow `CHARGE_RULE_VERSION`.

## Saved rates are historical

Stored `CostPolicy` percentages (`includedBaseBps`, `markupBps`, `infrastructureMarkupBps`, and `vercelDailyPence`) remain on file as history. The global-rule estimate uses billable and date coverage from those rows. It does not apply the saved percentages or the saved daily membership amount. The known iTrader seed row is that historical setup. It does not replace the universal rule.

Subscription invoices, allocated expenses, payments, and credits are not added to the provisional estimate. Approved outstanding is a separate figure.

## Model aliases and ambiguous labels

Included Grok and Composer match exact family names and Cursor-prefixed or versioned aliases: `(cursor-)?(grok|composer)(-...)`, case-insensitive. Examples include `grok-4` and `cursor-composer-2`.

Included Cursor with an empty model, or a label of `default`, `auto`, `unknown`, or `unspecified`, is not priced. Those rows stay held. Unknown funding stays excluded and is not relabelled as free credit. Free and free-credit funding stay out of the comparison charge.

## Live, provisional, and approved

The provisional estimate is the Accounts headline for included, on-demand, and infrastructure pence. It is not an approved invoice basis. `approvedSnapshot` on the summary is `false`.

Infrastructure status comes from that estimate:

- `absent` means no infrastructure rows are in the charge. Pence stay `null`, which is missing, not a verified zero.
- `live` means infrastructure in this database is included at face value.
- `local-shadow` means the rows are local shadow evidence only.

A component pence of `0` is a calculated zero (for example included Grok). `null` means the amount is absent or not established. Approved outstanding uses current approved client charges minus customer payments, credits, and prepaid amounts. No approved charge leaves outstanding pence `null` with a reason. A net of zero stays `0`. Estimates, subscription invoices, and provider bills are not that balance.

## Existing wire compatibility

These contracts stay in place beside the new summary:

- `GET /api/costs/projects/{slug}/comparison` returns `mpdee-project-cost-comparison-v1` with `policyVersion` `mpdee-comparison-policy-v1`.
- `GET /api/costs/projects/{slug}/snapshot` returns `mpdee-project-cost-snapshot-v2`.
- The monthly ledger response remains provisional estimates and does not claim an approved snapshot.

The summary does not recalculate GBP from comparison line pence, does not fold frozen legacy charges into the provisional estimate, and does not add subscription invoices or payments to the estimate.

## Summary endpoint

`GET /api/costs/projects/{slug}/summary` is a read-only Node route (`force-dynamic`, `maxDuration` 60) with `Cache-Control: private, no-store`. The slug must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`. The route calls `validProjectReadToken` before any data read. A missing or bad bearer token is 401. An unconfigured token map is 503. An absent or archived project is 404. A calculation failure is a generic 500 and does not return secrets or source errors. The route does not write and does not add a new authentication mechanism.

The body is `mpdee-project-cost-summary-v1`:

- `project` is the requested slug. `source` is `mpdee-accounts`. `pricingRuleVersion` is `CHARGE_RULE_VERSION`. `currency` is `GBP`.
- `estimate.totalPence`, `includedPence`, `onDemandPence`, and `infrastructurePence` are the provisional estimate headline and component pence, as safe integers or `null`.
- `fxEstimated` and `fxMissingRows` come from that same headline. `partial` is also true when infrastructure is absent or known project rows remain held, have unknown funding, lack explicit attribution, or have unreadable timestamps. Legitimate free or duplicate exclusions do not alone mark a total partial.
- `coverage` reports event bounds, row counts, `infrastructureStatus`, and exclusions as key, label, rows, and reason only. Native decimal units are not serialized.
- Exclusion reasons that still say `iTrader` are rewritten to neutral project language for every slug other than `itrader`.
- `outstanding` is the approved balance and reason from `loadProjectComparison(slug, LEDGER_START, null)`.
- `pricing` states the universal rule, including dated FX estimates.
- `sourceUpdatedAt` is the latest underlying usage revision clock, not the request time. `asOf` is the estimate observation time.
- `revision` is a SHA-256 over the project, central rule, ledger start, source revision, comparison revision, estimate, coverage, outstanding, and pricing. It excludes `asOf`.

Authorization uses the existing project-scoped map `COSTS_PROJECT_READ_TOKEN_SHA256_BY_SLUG`: a JSON object of slug to distinct lowercase SHA-256 digests. Send `Authorization: Bearer` with the project token. Ingest credentials and administrator sessions do not grant this route.

## Staged iTrader accounts-reader cutover

iTrader can later read this summary for centrally calculated GBP. That reader switch is a later gate in `cutover-plan.md`. Until those gates pass, iTrader remains the writer, this summary stays provisional, and both applications must not issue charges for the same cost. Shipping this route does not enable the reader, freeze approved snapshots, or validate live totals.
