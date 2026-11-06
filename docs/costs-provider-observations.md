# Provisional provider observations

`/costs/provider-observations` is a read-only, authenticated report of Vercel export snapshots. This is evidence, not a financial ledger. The isolated `CostProviderObservation` table is never read by legacy cost reports and does not create expenses, usage events, invoices, allocations, payments or charges. Decimal strings are native provider-reported values in JSON, not floating-pound financial persistence.

## Import contract

`POST /api/costs/provider-observations` accepts the existing `COSTS_INGEST_TOKEN` bearer authentication, or an authenticated writer with an exact same-origin `Origin` header. `GET` accepts that token or any authenticated reader. All API responses are `private, no-store`. The page is dynamic and has no write controls.

The strict JSON body is limited to 131072 streamed bytes:

```json
{
  "version": "mpdee-provider-observation-v1",
  "provider": "vercel",
  "accountRef": "team_example",
  "sourceKey": "export:2026-11",
  "sourceHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "observedAt": "2026-11-06T20:00:00Z",
  "coverage": "partial",
  "status": "requires_reconciliation",
  "periods": [{ "from": "2026-11-01", "to": "2026-11-07" }],
  "gaps": [{ "from": "2026-11-07", "to": "2026-12-01" }],
  "groups": [{
    "projectId": null,
    "resourceId": "prj_example",
    "currency": "USD",
    "usageValue": "12.3456",
    "subscriptionValue": "20.00"
  }],
  "notes": "Partial export; reconcile with provider billing before financial use."
}
```

- Only `vercel` is supported. Account/source/project/resource identifiers are 1-160 ASCII letters, digits, `_`, `.`, `:`, `-`, starting with a letter or digit.
- `sourceHash` is the export's 64-hex SHA-256, supplied by the importer, not independently verified against an uploaded file. The server derives a separate SHA-256 checksum over the schema-normalized JSON.
- `observedAt` is an ISO timestamp with a timezone. Period/gap boundaries accept real `YYYY-MM-DD` dates or ISO timestamps with timezones, on or after 1900-01-01. Ends are exclusive and must follow starts. There must be 1-31 native periods and at most 31 declared gaps.
- There are at most 200 resource groups. Optional/null `projectId` refers to an existing Accounts **cost project**, not a Vercel project. Optional/null `resourceId` identifies the provider resource; it does not automatically map projects.
- Values are nonnegative plain decimal strings up to 1000000000 inclusive, with at most 18 fractional digits. Numbers, signs, exponents, NaN and Infinity are rejected. Currency is exactly GBP, USD or EUR.
- Coverage is `partial` or `complete`; status is `requires_reconciliation` or `provider_reported`. These are source assertions, not independently verified reconciliation or payment status.
- Notes are optional, maximum 500 characters. Unknown fields, including cash-paid, expense, tax and charge assertions, are rejected. Empty groups or gaps do not assert zero cost or completeness.

## Replay, corrections and bounded reporting

Exact replay returns HTTP 200 `duplicate` with the original ID/checksum; new evidence returns HTTP 201 `added`. Deduplication is `(provider, accountRef, sourceKey, checksum)`. A changed payload under the same source identity is appended, never overwrites history. Replay does not promote an old correction.

Reports select only the latest observation per `(provider, accountRef, sourceKey)`, ordered by `observedAt`, then `createdAt`, then ID descending. A late-arriving export with an older observation date does not supersede newer evidence. PostgreSQL performs latest selection before the result cap, rather than fetching an unbounded history.

GET accepts only `provider=vercel`, `accountRef`, `sourceKey` and `limit` (default 50, maximum 100); duplicate/unknown query parameters are rejected. It returns `records`, `limit`, `truncated`, `selection` and explicit warning metadata. Results are source-identity ordered; a truncated report must be narrowed by account/source. There is no unbounded export or historical correction listing.

Different source keys can cover overlapping windows. **Never add snapshots together**, even when coverage is declared complete. Reports show each resource/project's usage and subscription values separately, without aggregation, FX or a grand total. Partial coverage, declared gaps and reconciliation status have per-observation warnings; non-financial and overlap warnings always apply, including outside a truncated view.

Migration `20261106210000_provider_observations` is additive and requires a separately authorized deployment. No database migration or production import is performed by implementing this feature.
