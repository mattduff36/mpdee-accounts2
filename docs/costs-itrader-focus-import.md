# iTrader FOCUS import

Manually imports hosting charges that iTrader has already classified. This does not collect from Vercel, schedule anything, or allocate shared or database cost.

## Lineage

The source records come from the iTrader writer:

- `D:/Websites/iommarket/lib/costs/focus.ts` reads FOCUS rows and keeps the provider decimal text.
- `D:/Websites/iommarket/lib/costs/classify.ts` builds the bucket id and separates hosting, database, and shared rows.
- `D:/Websites/iommarket/lib/costs/ledger.ts` stores the latest classified charge revision. Its marked GBP figure is not an Accounts amount.

Accounts reads a file the lead exports from that ledger. `exportedAt` and `sourceReadOnly` only identify the file. They do not authorise a write.

## Input

`itrader-focus-export-v1` JSON:

- `accountRef`, `sourceProjectRef`, and `databaseResourceRefs` are explicit.
- Each row is the latest revision of one bucket, joined to its charge entry. Reversal entries are not part of this file.
- `sourceId` is the iTrader bucket id. Hosting ids look like `vercel:VERCEL_HOSTING:<projectRef>:<serviceName>:<serviceCategory>:<ChargeCategory>:<PricingCategory>:<PricingUnit>:<ConsumedUnit>:<RegionId>:<periodStart>:<periodEnd>`.
- `billedAmount` is the native decimal string. A checksum is audit metadata and is never an amount.
- `periodStart`, `periodEnd`, and `exportedAt` use exact UTC ISO timestamps with milliseconds, such as `2026-09-01T07:00:00.000Z`. When exporting PostgreSQL timestamps, format the same UTC instant with `toISOString()` and preserve the original bucket id and amount text.

Accepted rows are only `classified: true`, `quarantined: false`, `category: VERCEL_HOSTING`, for the configured project, on or after the comparison ledger start (`2026-08-13T23:00:00.000Z`). Zero amounts stay. Negative amounts stay only for Credit and Adjustment. Tax is left out so totals stay ex-VAT.

These stay out as well: shared Vercel, quarantine, unclassified or unknown attribution, database rows (including ids listed only as `databaseResourceRefs`), synthetic `vercel:membership:` ids, and periods before the ledger boundary. The importer does not apply iTrader share splits, 60/110 display markup, converted GBP, or payments.

## Usage

Dry-run is the default. It plans the file and checks that the Accounts project slug has exactly one `vercel-resource` mapping whose value is `--project-ref`.

```text
npx tsx scripts/costs/import-itrader-focus.ts --input export.json --project itrader --project-ref prj_example --account-ref team_example
```

`--apply` writes only when that check passes, the plan has no rejected rows, and `DATABASE_URL` is already a local Postgres host (`localhost`, `127.0.0.1`, `::1`, or `*.localhost`). There is no remote override. The writer is the existing `importUsage` path, in chunks of at most 5000 events. Output is counts only: accepted, excluded, rejected, and, after apply, added, revised, and duplicate. It does not print the database URL, source rows, or payloads.

The shell must already have `DATABASE_URL`. This command does not read `.env` files.

## Limits

- One manual file of records the iTrader ledger already holds. No new collector or long-running observation.
- No second copy of a provider expense beyond this usage import.
- No guessed split of shared Vercel or database charges.
- A rejected row blocks `--apply` for that file. Fix the export and run it again; the command does not retry or schedule itself.
