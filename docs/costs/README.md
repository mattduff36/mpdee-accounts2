# Multi-project cost ledger

The ledger is live on `main` at https://accounts.mpdee.info. On 28 September 2026, the owner approved retiring preview: its branch and `neon-mpdeea-2-dev` database were deleted after backups, data reconciliation and authenticated production checks. Production uses `neon-mpdeea-2`. Do not reuse old preview credentials or attempt to run against the retired database.

The cost module remains a review ledger: it does not automatically create accounting expenses or invoices. Reviewed historical expenses were imported separately with source notes. iTrader’s existing writer remains active until its own historical reconciliation and cutover.

## What is implemented

- `/costs`: account-wide monthly ledger, project filter, native-currency nominal value/provider cost/client estimate, source coverage and unassigned counts.
- `/costs/projects`: projects linked to existing clients, client default policies, project overrides, effective dates, exact workspace/conversation/provider-resource mappings.
- `/costs/review`: manual attribution with a recorded reason. Reimports preserve manual decisions.
- `/costs/import`: authenticated JSON import. `/api/costs/ingest` also accepts a dedicated bearer token. `/api/costs/export` produces a review JSON export.
- Event identity is shared across branches and independent of the branch performing the import. Monetary corrections append revisions. Reimports do not append duplicate events. Database transaction locks serialise writers.
- Source money uses integer 1/10,000,000 currency units. Existing Accounts documents remain integer GBP pence. Native currencies are never summed together.
- Included Cursor: nominal value × (included base percentage + markup percentage). On-demand: precise provider billed cost × (100% + markup). Infrastructure: billed amount × (100% + infrastructure markup). These are percentage points, not markup on a discounted base.
- Initial known-project setup gives iTrader 50% + 10% = 60% included and 110% on-demand, with infrastructure at face value. MPDEE Accounts is internal/non-billable. Initial policy date is 1 August 2026. Existing entries are not overwritten by repeating setup.
- All scopes without a policy are held, rather than assuming a client fee. Client defaults apply only where no effective project override exists.

## Operating the live ledger

Use `main` for the approved personal-site workflow. Sign in to the production site, open Project Costs, and review project mappings and rates before importing new sources. Keep dedicated local collector credentials outside the repository. Production migrations remain additive and are applied by the guarded Vercel production build. A future test database must be created and verified explicitly; the former preview database no longer exists.

## Local Cursor collector

Requires Node 22.13+ and a signed-in Cursor desktop on Windows/macOS/Linux. Run from `D:\Websites\mpdee-accounts2` after pulling main.

```powershell
npm run costs:collect -- --days 2
```

Files are written under `%LOCALAPPDATA%\mpdee-accounts\costs-outbox` on Windows, or `~/.local/share/mpdee-accounts/costs-outbox` elsewhere. They contain private usage metadata and conversation IDs but no owningUser ID, prompts, cookies, access tokens or state database. Do not commit them. The collector reads only conversation filenames to map workspaces. Duplicate conversation references across workspaces remain unassigned.

Upload files through the production app, or configure `COSTS_INGEST_URL` (HTTPS, ending `/api/costs/ingest`) and a dedicated 32+ character `COSTS_INGEST_TOKEN` locally and on the destination Production deployment, then run:

```powershell
npm run costs:sync -- --days 2
```

The collector uses the existing undocumented dashboard adapter, validates the count against all pages, fails closed on malformed/partial data, never follows upload redirects, and retains files for retries. It does not modify iTrader's outbox. `--days` sets the initial history only. Subsequent runs use a durable UTC-day checkpoint, re-fetch the previous two completed days, and refresh the current partial day. Daily snapshots and content/destination receipts make retries safe; incomplete responses do not replace complete snapshots. Recover a longer gap in contiguous chunks using `--from YYYY-MM-DD --to YYYY-MM-DD` (inclusive UTC dates, at most 45 days per run). A backfill cannot advance the checkpoint across a missing interval. Daily batches over 5,000 events/3 MB stop for review. `npm run costs:flush` retries retained complete files without contacting Cursor. A local hourly/logon scheduled task is configured on the current PC; its installed runner now targets only `https://accounts.mpdee.info/api/costs/ingest`. It runs under the signed-in user with no password stored in Task Scheduler. Do not run it in GitHub Actions or Vercel: those environments do not have your local Cursor session. Failed collection must not block commits or pushes.

## Import contract

```json
{
  "version": "mpdee-costs-v1",
  "provider": "cursor",
  "accountRef": "stable-pseudonymous-account-reference",
  "quality": "complete",
  "events": [{
    "timestamp": "2026-09-26T15:36:24.000Z",
    "model": "provider-model-name",
    "conversationId": "conversation-reference",
    "workspaceRef": "d-Websites-iommarket",
    "kind": "USAGE_EVENT_KIND_USAGE_BASED",
    "isTokenBasedCall": true,
    "chargedCents": "233.65",
    "usageBasedCosts": "2.34",
    "cursorTokenFee": 0,
    "tokenUsage": { "inputTokens": 21, "outputTokens": 3591, "cacheReadTokens": 915305, "cacheWriteTokens": 379699, "totalCents": "233.65" }
  }]
}
```

Cursor `tokenUsage.totalCents` supplies nominal value, `chargedCents` supplies precise on-demand cents, and included events have zero per-event provider cash. Neither `isChargeable` nor a guessed $400 cutoff determines funding. Unknown labels, missing amounts, identity collisions and nonzero fees are held. A complete import is a complete fetched window, not evidence that the whole billing cycle has been collected.

For infrastructure choose provider `vercel`, `supabase` or `manual`. Each event needs `sourceId` (stable invoice-line or provider-bucket ID), `timestamp`, `billedAmount` in major currency units, `currency` (USD/GBP/EUR) and optionally `resourceRef`, `description` and `nominalAmount`. Preserve the same ID for corrections. Credits may be negative. Optional batch `fxGbp` stores a reviewed GBP rate on revisions. Supabase billed through Vercel must be imported once, through the Vercel source. Do not import both usage estimates and final invoice lines as separate costs for the same charge. Subscription/shared costs require an explicit allocation, not charging the full invoice to every project.

## Audit and limitations

- All data here is provisional. No invoice creation or automatic accounting expense creation is implemented.
- Database revisions preserve source cost history. Current estimates are recalculated with the chosen client link and policy, so changing a historical policy date or client link can change estimates. Freeze approved charges and policy/FX snapshots before adding invoicing.
- No live Vercel/Supabase billing API connector or automatic infrastructure reconciliation is enabled. Import reviewed billing records in the documented format first. Port iTrader's existing daily membership allocation only after reconciling historical imports so it is not duplicated.
- No automatic allowance balance or exhaustion alert yet. Account-wide funding labels show actual on-demand usage. Credit pools and renewal dates need a verified provider observation before a balance/alert can be accurate.
- The undocumented Cursor endpoint can change. Keep export reconciliation and a manual import route. A CSV can verify totals but cannot safely supply conversation/project identity on its own. Daily aggregated legacy logs are not an event-level backfill.
- Collision records stay held after smaller overlapping imports. Resolve against provider evidence before billing. Imported source records are retained rather than deleted if an event disappears from a later response.
- Interactive totals cap at 50,000 events per month/filter and explicitly refuse larger result sets. Export includes every event in that filter, and the table offers 50 records per page.
- The iTrader application remains authoritative during comparison. Do not configure both apps to issue charges. A later cutover needs a reconciled historical migration, one shared Accounts API, iTrader project-scoped read credentials and removal of its independent writer.

## Verification performed in the implementation workspace

TypeScript checks and cost unit tests cover precise cents, 60%/110% charging, infrastructure credits, unknown funding/fees, identity collisions, correction identity, token authentication, field sanitization and effective-date precedence. The full existing test suite is also run. The production build compiles without a connected database, but existing reporting pages log missing DATABASE_URL while collecting page data. The development database copy, migrations, authenticated HTTP page checks, real import/replay and real PostgreSQL correction checks are recorded in `preview-verification.md`. The production cutover also verified authenticated pages, duplicate-safe ingestion and a successful production scheduled collection run.

## Installing the local schedule

Run `scripts/costs/install-task.ps1` locally to install an hourly/logon collection-only snapshot. It refuses to overwrite an existing task. With packaged Windows apps, pass `-StorageBase` pointing to the verified physical local-cache directory if AppData is redirected; Task Scheduler cannot use the package-virtual path. The configuration and status are in `mpdee-accounts/costs-automation` below that storage base. The runner sets the same storage base for its outbox and never inherits upload credentials or destination accidentally. Updating repository collector code does not update the installed snapshot: validate and copy the collector modules deliberately, then verify a scheduled run. Keep the saved local files during updates. Upload activation remains separate from installation.

See `project-read-api.md` for the implemented, locally verified project-scoped read API; hosted activation and the iTrader reader switch remain pending.
