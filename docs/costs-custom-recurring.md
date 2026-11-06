# Custom recurring development commitments

`/costs/custom-recurring` lists owner-entered monthly rates, separate from
subscription invoices, usage evidence, accounting expenses and client finance.
Writers can create, edit and disable commitments; readers cannot see write
controls or submit writes. No period estimate, payment, tax, FX conversion,
expense, invoice or client charge is generated. An enabled commitment is only
effective from its start date up to its optional **exclusive** end date.
It is not proof that any payment occurred. Currencies are never added together.

## Authentication and transport

`/api/costs/custom-recurring` returns private, non-cacheable JSON.

- `GET`: active authenticated session (including readonly), or the existing
  `COSTS_INGEST_TOKEN` in `Authorization: Bearer <token>`.
- `POST`: that machine token, or an authenticated admin/writer session with an
  `Origin` header exactly equal to the request origin.
- `PATCH`: authenticated admin/writer session and exact same-origin header only.
  A machine token alone never grants edit rights.

The middleware defers these three methods to their authenticated handlers.
Unauthenticated requests return 401; readonly writes and invalid origins return
403. Invalid fields/query/JSON return 400, bodies over 16,384 bytes return 413,
missing edit targets return 404, and source/revision conflicts return 409.
Unexpected failures return a generic 500 without internal details.

## Create/import: POST

Send one JSON object, not a batch. Every field below is required, including
explicit nulls, the boolean flag and the fixed version/recurrence:

```json
{
  "version": "mpdee-custom-recurring-v1",
  "sourceKey": "worker-live:itrader:imagekit",
  "projectId": "existing_cost_project_id",
  "provider": "ImageKit",
  "name": "Development media",
  "currency": "USD",
  "amountMinor": 900,
  "recurrence": "monthly",
  "effectiveStart": "2026-11-01",
  "effectiveEnd": null,
  "active": true,
  "notes": null
}
```

This example records USD 9.00/month, **not** a paid USD 9.00 invoice. Choose the
actual existing `CostProject.id` and evidenced effective date; no project, date
or tax/payment facts are guessed. This documentation does not import anything.

`sourceKey` is a globally unique, stable external commitment identity, not a
content hash or observation time. Namespace by source/project/provider where
needed. It and `projectId` are 1-160 characters, beginning alphanumeric, then
letters/digits/underscore/dot/colon/hyphen. Provider and name are trimmed,
1-120 characters, without control characters. Currency is exactly GBP, USD or
EUR; all use 100 minor units per major unit. `amountMinor` is a JSON integer
from 0 to 2,000,000,000 (explicit zero is accepted). Recurrence is only `monthly`.
Dates are exact real `YYYY-MM-DD` days from 1900-01-01 to 9999-12-31, and end
must be later than start. Notes are null or trimmed text up to 2,000 characters;
newlines/tabs are allowed, other control characters are rejected. Do not enter
credentials or private customer content. Unknown fields, including payment,
tax, invoice, FX or client-charge claims, are rejected.

New record response (201):

```json
{"version":"mpdee-custom-recurring-ack-v1","status":"added","id":"generated_id","revision":1}
```

Identical normalized source replay returns 200 with `status: "duplicate"` and
the **current** revision. The original import checksum never changes when an
Accounts writer edits the record: an original replay remains a duplicate and
does not restore the old values. Any different payload for an existing source
key returns 409, even if it matches the currently edited values. No machine
replay overwrites Accounts edits. Do not create a fresh key to bypass a conflict.
The UI uses a stable `accounts:<uuid>` key across uncertain network retries.

## Edit/disable: PATCH

Send all mutable fields from POST (project, provider, name, currency, amount,
recurrence, dates, active and notes), plus `version`, `id` and
`expectedRevision`. **Omit `sourceKey`**; it is immutable.

```json
{
  "version": "mpdee-custom-recurring-v1",
  "id": "generated_id",
  "expectedRevision": 1,
  "projectId": "existing_cost_project_id",
  "provider": "ImageKit",
  "name": "Development media",
  "currency": "USD",
  "amountMinor": 1200,
  "recurrence": "monthly",
  "effectiveStart": "2026-11-01",
  "effectiveEnd": null,
  "active": false,
  "notes": "Disabled after review"
}
```

`expectedRevision` is an integer from 1 to 1,999,999,999. An edit increments the
revision even if values are unchanged. Response (200):

```json
{"version":"mpdee-custom-recurring-ack-v1","status":"updated","id":"generated_id","revision":2}
```

Stale revisions return 409, never last-write-wins. Reload current values before
making a deliberate replacement. Disabling uses `active: false`; there is no
delete API. Initial and every edited snapshot, revision, actor type/ID and
timestamp are recorded in `CostCustomRecurringRevision` in the same transaction.
Snapshots include notes but are not exposed by GET. A transaction advisory lock
serializes imports/edits, and updates additionally compare the expected revision.

## Read: GET

Optional query parameters: `projectId` (exact project ID), `after` (previous
page's `nextCursor`), `limit` (1-100, default 50). Unknown or repeated parameters
are rejected. Records are ordered ascending by ID; pagination is a bounded
live listing, not a frozen financial report. Includes enabled and disabled,
past and future commitments; consumers must preserve flags/dates. No totals.

Exact response shape:

```json
{
  "version": "mpdee-custom-recurring-list-v1",
  "records": [{
    "id": "generated_id",
    "sourceKey": "worker-live:itrader:imagekit",
    "projectId": "existing_cost_project_id",
    "project": {"slug": "itrader", "name": "iTrader"},
    "provider": "ImageKit",
    "name": "Development media",
    "currency": "USD",
    "amountMinor": 900,
    "recurrence": "monthly",
    "effectiveStart": "2026-11-01",
    "effectiveEnd": null,
    "active": true,
    "revision": 1,
    "createdAt": "2026-11-06T20:00:00.000Z",
    "updatedAt": "2026-11-06T20:00:00.000Z",
    "evidenceKind": "owner_entered_commitment",
    "paymentStatus": "unknown",
    "taxStatus": "unknown"
  }],
  "nextCursor": null
}
```

`nextCursor` is the last returned ID if another page exists, otherwise null.
The allowlist omits notes, import checksums, audit actors/history, project client
links and other finance records. Worker Live must label this as a monthly
commitment, not paid cost or a period total.

## Schema rollout

The additive `20261106200000_custom_recurring_costs` migration creates only the
two recurring-cost tables, their indexes, constraints and restrictive project
foreign key. Existing calculations/tables are unchanged. It must be reviewed
and applied by the parent release process before the page/API can be used.
Prisma client generation does not apply it. No database migration or production
import is performed by this implementation.
