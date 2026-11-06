# Manual project cost allocation

Subscription invoices and custom recurring commitments have an easy percentage editor
on their source pages. Choose Accounts cost projects, enter up to two decimal places,
add/remove rows, or use **Assign remaining here**. Save applies only after explicit
owner action. **Clear / save wholly unallocated** saves an empty override, rather than
restoring a recurring cost's old single-project default. No hypothetical split is seeded.

These are **user-selected, not measured usage**. A subscription split applies only to
that exact invoice ID; future invoices start unallocated. A recurring split persists
for that commitment's ongoing monthly rate, including subsequent rate edits. Until
the first explicit override, existing and new recurring costs retain their selected
single project's 100% default. Changing the original project after an override does not
replace the split. Newly added commitments open their own page, ready for split editing.

## Persistence and concurrency

`20261106220000_manual_cost_allocations` is additive: three isolated tables for settings,
append-only revisions, and revision project shares. Foreign keys retain exact source and
project identities. Each revision records the signed-in actor ID, time, contract version,
shares and unallocated basis points. Source imports/checksums, expenses, pricing, invoice
creation and existing totals are untouched. Import replays cannot replace allocations.

Saves are transactional and use a separate advisory lock plus revision comparison.
`expectedRevision: 0` means no explicit allocation yet; first save creates revision 1.
Every successful save, including clear, appends a revision. Stale saves return 409 and
must reload. Missing sources return 404; nonexistent projects or invalid fields return 400.

## API and reporting

`POST /api/costs/manual-allocations` requires a signed-in writer and an exact same-origin
`Origin` header; machine tokens **never** authorize allocation writes. Example shape:

```json
{
  "version": "mpdee-manual-allocation-v1",
  "sourceKind": "subscription_invoice",
  "sourceId": "exact-accounts-source-id",
  "expectedRevision": 0,
  "shares": [{"projectId": "exact-accounts-project-id", "shareBps": 10000}]
}
```

`sourceKind` is `subscription_invoice` or `custom_recurring`. Shares are positive integer
basis points, unique by project, at most 100 rows, summing to at most 10000. Empty shares
explicitly mean 100% unallocated. Unknown fields, fractional basis points, duplicate
projects and duplicate query parameters are rejected; request bodies are capped at 16 KiB.

`GET /api/costs/manual-allocations?sourceKind=subscription_invoice` returns
`mpdee-manual-allocation-report-v1`. It accepts reader/writer sessions or the existing
`COSTS_INGEST_TOKEN` bearer token, consistent with source cost read APIs. Responses are
private/no-store and do not include private notes, actor details or credentials.
Optional strict parameters: `sourceId` (exact ID), `after` (exclusive source-ID cursor),
`limit` (1-100, default 50), `asOf` (ISO date, default UTC today). `sourceId` and `after`
are mutually exclusive. `asOf` only selects enabled recurring costs whose effective
dates include that day; their full monthly rate is reported, never prorated.

The separate `/costs/manual-allocations` page exposes the same report and page totals.
Invoices and monthly commitments are separate non-additive views. `records` contain
source metadata, current `allocation` revision/basis/shares/remainder, and `buckets`
for each project **plus unallocated**, including zero remainder. `pageTotals` sums
only those buckets by project and native currency, never source plus allocations.
Follow `nextCursor` for complete coverage; page totals are not global totals.

Native minor units and reference GBP pence are independently subdivided with deterministic
largest-remainder integer rounding. Ties use ascending project ID, with unallocated last.
Every set of buckets conserves its original total. Subscription GBP uses its immutable
invoice estimate; recurring GBP uses existing stored reference FX on/before `asOf`
(at most seven days old), or GBP identity. No external FX fetch occurs. Missing FX stays
null, including incomplete aggregate GBP, never a fabricated zero. No totals here should
be added to usage, provider observations, accounting expenses or client charges.

Migration deployment and live-database acceptance require separate authorization.
