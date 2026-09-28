# Multi-project cost ledger: preview rollout

This module is a parallel review ledger in MPDEE Accounts. It does not change iTrader, accounting expenses, invoices, payments, or production database configuration. The preview branch must use `neon-mpdeea-2-dev`, not the production database.

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

## Preview activation

1. In Vercel, confirm `DATABASE_URL` for **Preview / preview branch** points to the newly created dev database. A storage connection does not prove environment scoping. Keep production untouched. Configure `SESSION_SECRET` for preview. Use a separate preview ingest token if enabling automated upload.
2. From the Accounts clone on `preview`, pull the latest commit and run `npm ci`.
3. Pull preview variables to a gitignored file using an authenticated Vercel CLI, or use your local dev database settings. Do not paste URLs or tokens into chat or commit them. Check the database hostname/database identity without printing credentials.
4. Apply migrations explicitly to the verified dev database: `npm run db:migrate:deploy`. This adds six cost tables and policy checks. Build/finalise intentionally never migrates preview. If the new database is empty, the existing migrations create the accounting tables too. If it is an existing clone, preserve its migration history. Do not resolve/reapply the baseline or use db push.
5. For an empty dev database, create the admin using the existing seed procedure in the main README. Do not seed demo accounting data into an existing database.
6. Open the preview deployment, sign in, and choose Project Costs → Projects & rates → Add iTrader and Accounts. Select the correct existing client for iTrader. Add other projects and client defaults as required. Known Vercel IDs are preconfigured for iTrader and Accounts. The second setup button adds all 41 Vercel project resources observed on 27 September 2026, without guessing client links, Cursor workspaces or rates. Other mappings require evidence.
7. Import a short complete Cursor window and reconcile it before scheduling collection. Test reimport counts, unassigned work, a changed monetary amount, effective dates and a read-only login.

## Local Cursor collector

Requires Node 22.13+ and a signed-in Cursor desktop on Windows/macOS/Linux. Run from `D:\Websites\mpdee-accounts2` after pulling preview.

```powershell
npm run costs:collect -- --days 2
```

Files are written under `%LOCALAPPDATA%\mpdee-accounts\costs-outbox` on Windows, or `~/.local/share/mpdee-accounts/costs-outbox` elsewhere. They contain private usage metadata and conversation IDs but no owningUser ID, prompts, cookies, access tokens or state database. Do not commit them. The collector reads only conversation filenames to map workspaces. Duplicate conversation references across workspaces remain unassigned.

Upload files through the preview app, or configure `COSTS_INGEST_URL` (HTTPS, ending `/api/costs/ingest`) and a dedicated 32+ character `COSTS_INGEST_TOKEN` locally and on the destination Preview deployment, then run:

```powershell
npm run costs:sync -- --days 2
```

The collector uses the existing undocumented dashboard adapter, validates the count against all pages, fails closed on malformed/partial data, never follows upload redirects, and retains files for retries. It does not modify iTrader's outbox. `--days` sets the initial history only. Subsequent runs use a durable UTC-day checkpoint, re-fetch the previous two completed days, and refresh the current partial day. Daily snapshots and content/destination receipts make retries safe; incomplete responses do not replace complete snapshots. Recover a longer gap in contiguous chunks using `--from YYYY-MM-DD --to YYYY-MM-DD` (inclusive UTC dates, at most 45 days per run). A backfill cannot advance the checkpoint across a missing interval. Daily batches over 5,000 events/3 MB stop for review. `npm run costs:flush` retries retained complete files without contacting Cursor. A local hourly/logon scheduled task is configured on the current PC; see `preview-verification.md` for its activation state. It runs under the signed-in user with no password stored in Task Scheduler. Do not run it in GitHub Actions or Vercel: those environments do not have your local Cursor session. Failed collection must not block commits or pushes.

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

## Audit and limitations before production cutover

- All data here is provisional. No invoice creation or automatic accounting expense creation is implemented.
- Database revisions preserve source cost history. Current preview estimates are recalculated with the chosen client link and policy, so changing a historical policy date or client link can change estimates. Freeze approved charges and policy/FX snapshots before adding invoicing.
- No live Vercel/Supabase billing API connector or automatic infrastructure reconciliation is enabled. Import reviewed billing records in the documented format first. Port iTrader's existing daily membership allocation only after reconciling historical imports so it is not duplicated.
- No automatic allowance balance or exhaustion alert yet. Account-wide funding labels show actual on-demand usage. Credit pools and renewal dates need a verified provider observation before a balance/alert can be accurate.
- The undocumented Cursor endpoint can change. Keep export reconciliation and a manual import route. A CSV can verify totals but cannot safely supply conversation/project identity on its own. Daily aggregated legacy logs are not an event-level backfill.
- Collision records stay held after smaller overlapping imports. Resolve against provider evidence before billing. Imported source records are retained rather than deleted if an event disappears from a later response.
- Interactive totals cap at 50,000 events per month/filter and explicitly refuse larger result sets. Export includes every event in that filter, although only the latest 200 appear in the table.
- The iTrader application remains authoritative during comparison. Do not configure both apps to issue charges. A later cutover needs a reconciled historical migration, one shared Accounts API, iTrader project-scoped read credentials and removal of its independent writer.

## Verification performed in the implementation workspace

TypeScript checks and cost unit tests cover precise cents, 60%/110% charging, infrastructure credits, unknown funding/fees, identity collisions, correction identity, token authentication, field sanitization and effective-date precedence. The full existing test suite is also run. The production build compiles without a connected database, but existing reporting pages log missing DATABASE_URL while collecting page data. The development database copy, migrations, authenticated HTTP page checks, real import/replay and real PostgreSQL correction checks are recorded in `preview-verification.md`. Hosted preview ingestion and visual browser checks remain separate gates; local HTTP checks do not establish those.

## Installing the local schedule

Run `scripts/costs/install-task.ps1` locally to install an hourly/logon collection-only snapshot. It refuses to overwrite an existing task. With packaged Windows apps, pass `-StorageBase` pointing to the verified physical local-cache directory if AppData is redirected; Task Scheduler cannot use the package-virtual path. The configuration and status are in `mpdee-accounts/costs-automation` below that storage base. The runner sets the same storage base for its outbox and never inherits upload credentials or destination accidentally. Updating repository collector code does not update the installed snapshot: validate and copy the collector modules deliberately, then verify a scheduled run. Keep the saved local files during updates. Upload activation remains separate from installation.

See `project-read-api.md` for the implemented, locally verified project-scoped read API; hosted activation and the iTrader reader switch remain pending.
