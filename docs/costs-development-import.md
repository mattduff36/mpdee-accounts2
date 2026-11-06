# Development evidence import contract

`mpdee-costs-v1` accepts `provider: "openai"` or `"codex"` alongside the unchanged
Cursor, Vercel, Supabase and manual formats. This is a normalization contract, not
a collector or permission to import data.

```json
{
  "version": "mpdee-costs-v1",
  "provider": "codex",
  "accountRef": "development-account",
  "quality": "complete",
  "events": [{
    "timestamp": "2026-11-01T12:00:00.000Z",
    "sourceId": "task-42:attempt-1",
    "model": "example-model",
    "nominalAmount": "1.2345678",
    "currency": "USD",
    "development": {
      "recordClass": "task-measurement",
      "workItemId": "work-42",
      "parentChatId": "chat-10",
      "taskId": "task-42",
      "attempt": 1,
      "observedAt": "2026-11-02T09:00:00.000Z",
      "coverage": "complete"
    }
  }]
}
```

## Identity, evidence and privacy

- `sourceId` is a stable upstream event/bucket identifier, never an import-run ID,
  observation timestamp or hash of mutable amounts. Use a distinct ID per task
  attempt. It is 1-250 characters, starts alphanumeric and otherwise permits
  letters, digits, `.`, `_`, `:`, `/`, `-`. Identity is scoped by provider and
  account; storage retains the existing `sourceId:0` convention. Duplicate IDs
  within a development batch fail before persistence.
- `development` is optional for existing providers but required for OpenAI/Codex.
  It is strict: no extra keys, raw prompts, code, credentials or free-text notes.
  Producers must send opaque references, not customer content or secrets.
- `recordClass` is the evidence kind: `task-measurement` for Codex/MPDEE task
  measurements, or `provider-daily-aggregate` for OpenAI reported daily usage.
  Both providers accept either class; the class must describe the source evidence.
- Work item, parent chat and task IDs are each 1-160 characters, start
  alphanumeric and otherwise permit letters, digits, `.`, `_`, `:`, `-`.
  `attempt` is an integer from 1 to 1,000,000. All four are required and non-null
  for task measurements; daily aggregates must include the fields but may use
  `null` where task lineage is unavailable. Do not invent task attribution.
- `observedAt` is the source observation time, an ISO timestamp with a timezone,
  canonicalized to UTC. `timestamp` is when the usage occurred, not when the file
  was imported. `coverage` is explicitly `complete`, `partial` or `unknown`.
- All validated development metadata participates in the deterministic revision
  checksum, not identity. Corrections revise the existing event. Legacy replays
  omitting optional metadata preserve previously validated metadata; explicit
  replacement metadata wins. Unknown/unsafe legacy metadata is not retained.

## Money and charging

`nominalAmount` is the reported/estimated monetary value of usage, in currency
units (prefer decimal strings, retained at the existing 1e-7 precision).
It is not cash. Optional `billedAmount` is separately evidenced cash; omission
means unknown, never zero. Missing nominal value remains unknown even if cash is
present. Token counts in `tokenUsage` are optional measurements and do not price
usage; Cursor-specific cents/labels do not determine development amounts.

Optional `development.funding` is `unknown` (default), `paid`, `grant` or
`subscription`. Explicit funding must come from separate evidence: tokens,
subscription membership and nominal usage do not establish funding, billed cash
or zero cash. A zero `billedAmount` is accepted only as an explicit source value.

Every OpenAI/Codex revision is `review`, with a client-charging hold, including
complete coverage, explicit paid funding, mapped projects and replay/corrections.
The existing service persists this quality and its ledger gate prevents client
charging. No pricing policy or Cursor/infrastructure billing rule is changed.

## Reporting and remaining integration

**Daily aggregates and task measurements are non-additive evidence.** They may
describe the same consumption. Never sum the two classes into one development
total or add a provider daily amount to task estimates. Report them separately,
with coverage and unknown funding/cash visible; reconciliation requires a future
explicit allocation/linking contract, not matching dates or token counts.

## Read-only development report

`/costs/development` is available to authenticated readers. The read-only
`GET /api/costs/development` also accepts the existing `COSTS_INGEST_TOKEN` as a
Bearer token for local Worker reads. It has no write handler, does not import
anything, and returns private, non-cacheable responses.

Parameters: `from` and exclusive `to` are exact `YYYY-MM-DD` UTC days, at most
366 days apart (default: the last 30 days including today). Optional `projectId`
selects one assigned project; `unassigned` selects null assignments. Omission or
an empty form field selects all assignments. `groupBy=day|week|month` defaults
to week; grouping uses source usage timestamps in `Europe/London`, Monday weeks
and calendar months, not import/observation dates. A grouped period can begin
before the requested window; only source events inside the UTC window count.

The response has independent `providerDailyAggregates` and `taskMeasurements`
sections, each with provider/currency totals and per-project/period groups.
There is deliberately no combined total. Task fields are estimates only; task
cash is not reported as actual cost. Provider cash is separately evidenced, not
inferred from nominal value or funding. `amount` is null if any contributing
amount is unknown; `knownAmount` is a labelled partial subtotal (or null), with
`known`/`unknown` counts. Explicit zero remains zero. No records does not prove
zero usage. Funding and source coverage counts remain visible.

Latest revisions only are selected, source identities are deduplicated by
provider/account/source key, currencies stay separate, and GBP uses only an
explicit recorded revision FX rate or original GBP. No rates are fetched.
Queries fetch at most 50,001 events and reject overflow rather than publishing
partial totals. Invalid development metadata also rejects the report. Responses
are allowlisted aggregates: no prompts, raw evidence, account references,
workspace paths or task/chat identifiers.

OpenAI/Codex events are excluded from legacy ledger, comparison, project
snapshot/billing, overview and client-period monetary read paths, with shared
provider guards protecting aggregation and client-charge helpers as well.
Collectors/API adapters, cross-class reconciliation, cash/grant verification and
future charging approval remain separate work. No database/schema change,
import, deployment or release is performed by this reporting integration.

Selected date bounds and defaults use Europe/London midnight, including BST transitions. Source observation ranges are retained per reporting bucket. Provider daily buckets retain native source boundaries, so they are not prorated into individual UK hours. Source coverage counts never imply complete calendar-period coverage.
