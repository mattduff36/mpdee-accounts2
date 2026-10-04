# Cost ledger cutover plan

## Outcome

Move the authoritative cost ledger from iTrader to MPDEE Accounts only after the source history, billing imports, project attribution and invoice basis reconcile. Keep the cutover one-way: Accounts becomes the sole writer, while iTrader consumes a project-scoped read-only Accounts API. Until the gates below pass, iTrader remains authoritative and both applications must not issue charges for the same costs.

This is an implementation plan. The project-scoped read API is implemented and verified on preview (see `project-read-api.md`). A local shadow comparison, infrastructure import planner and append-only `CostChargeSnapshot` model now exist. The production migration, historical import and iTrader writer cutover are not approved and must not be run from this change.

## Verified current state

- **iTrader is authoritative today.** Its cost documentation says the canonical ledger lives in production Postgres and admin views on other deployments call iTrader’s `/api/internal/cost-ledger`. That endpoint returns an owner-hidden dashboard representation; it is not a project-scoped Accounts API.
- **Vercel billing is ingested in iTrader.** Its scheduled/manual sync fetches Vercel FOCUS billing rows, classifies tagged iTrader project IDs and the configured database resource IDs, and stores source revisions. Supabase database costs visible through Vercel are therefore part of this Vercel feed and must be imported only once through Vercel. The current iTrader documentation says Supabase lines missing from FOCUS are entered manually as database costs; reconcile those against FOCUS before importing to avoid duplicates.
- **Shared Vercel rows have explicit handling.** Untagged team-level rows default to ignored; a configured shared policy allocates them across active projects, while unresolved rows are quarantined. Preserve the source row, project/resource identity, period, currency, source checksum and allocation evidence in the Accounts import.
- **The £0.38/day membership amount is separate from FOCUS.** iTrader writes a manual `vercel:membership:YYYY-MM-DD` entry for £0.38 per day, beginning with the first UTC day boundary after its ledger start of 13 August 2026 23:00 UTC. These rows are additional to Vercel FOCUS costs. Accounts’ preview README explicitly warns to port iTrader’s daily membership allocation only after reconciling historical imports so the charge is not duplicated.
- **Accounts currently has a preview review ledger.** Its cost module supports Cursor and manual/provider import/export, projects, policy and attribution review, and revision history. It has no live Vercel/Supabase billing connector or automatic infrastructure reconciliation. Its current docs state that iTrader stays authoritative during comparison and that project links and policy choices can change historical estimates.
- **Invoice approval already freezes a request amount and entry references in iTrader.** The proposed cutover must preserve the reviewed charge basis and history when ownership moves. Accounts documentation requires approved charges and policy/FX snapshots before invoicing; adding invoice issuance to Accounts is outside the completed implementation.

## Proposed sequence

### 1. Establish the comparison boundary

- Select a bounded historical period and inventory iTrader source records by source identity and billing period, including Vercel FOCUS, manual database costs, shared allocations, membership rows, Cursor charges, revisions, reversals, invoices and settlements.
- Agree the Accounts project/client links, effective-dated policies, currencies and FX treatment before importing. Keep unattributed, collided, incomplete or unsupported records held for review rather than assigning guessed clients or rates.
- Use source IDs and event identities for idempotent import. Re-imports must not create duplicate costs; corrections must append revisions or reversals and retain the audit trail.

### 2. Import provider billing once

- Import reviewed Vercel FOCUS source rows to Accounts with stable source IDs and original periods, amount, currency, resource/project tags and allocation metadata.
- Treat Supabase billed through Vercel as part of that same Vercel source. Do not add a second Supabase entry for the same billed usage. Add a separately sourced manual Supabase line only when provider evidence establishes it is absent from FOCUS, and record why it is separate.
- Reconcile all historical £0.38/day membership rows against the membership dates and source ledger. For each date, prove either the Vercel feed already includes that membership charge or it does not. Import/port the manual row only in the latter case. Confirm first/last included dates, any legacy boundary row or retirement, and total days × £0.38 against the existing iTrader entries. Do not infer that the £0.38 is included in a FOCUS row just because both are Vercel costs.
- Compare imported source totals and counts by provider, currency, period, project, held/unassigned status and revision. Resolve every difference and duplicate before proceeding. Keep iTrader as the comparison authority during this step.

### 3. Prepare a project-scoped read-only Accounts API

The local implementation provides `/api/costs/projects/{slug}/ledger?month=YYYY-MM` using a dedicated per-project bearer credential digest. It returns minimized provisional estimates and native-currency totals; it does not claim approved charges. Local HTTP checks and dedicated tests passed scope isolation and read-only access. Hosted deployment and iTrader integration remain planned. Enforce project scope server-side for every request; return only the required fields and status, with no account-wide ledger, other client/project data, secrets or write operations. Use a dedicated read credential and deny access by default when scope or configuration is missing. Keep provider ingestion, review, policy changes and approvals on Accounts administrative paths.

Before enabling the client, test authorized project access, rejected cross-project access, missing/invalid credentials, minimal response fields, pagination/window limits and stale/unavailable behavior. The current iTrader internal ledger route is a useful precedent for a canonical read boundary, but it does not satisfy project-scoped Accounts access.

### 4. Freeze approved charge snapshots before invoice work

Before Accounts can issue invoices, create immutable approval snapshots for each charge set: source entry/revision IDs, project and client attribution, effective policy version, FX rate and source evidence, approved GBP amount, approval actor/time and any exclusions or held lines. Invoice lines must refer to those frozen approved snapshots so later source corrections or policy edits cannot silently rewrite an approved invoice basis. Keep later corrections as explicit revisions/reversals and define how they appear in a subsequent adjustment. Reconcile each proposed snapshot total to both the reviewed Accounts view and the existing iTrader invoice/settlement references.

### 5. Cut over once

- Set a dated cutover boundary and stop iTrader ledger writes/collection before taking the final delta.
- Export and import that final delta with stable identities; reconcile counts, source totals, revisions, pending invoice requests, confirmed settlements and the approved snapshots.
- Switch the iTrader reader to the project-scoped Accounts read API. Confirm production iTrader has no ledger write path or write credentials after the switch.
- Enable Accounts as the sole writer only after read-path checks and reconciliation pass. Monitor first provider imports and compare rendered per-project totals and held records against the signed-off cutover report.
- Keep a rollback record of the cutover boundary and final source export. Rollback must not reactivate two writers; any return to iTrader requires stopping Accounts writes and transferring a new final delta first.

## Shadow comparison before any cutover

Do not run this sequence until the owner approves it. The shadow comparison is local and read-only. It does not deploy, apply `20261004010000_cost_charge_snapshots` to production, edit live `CostPolicy` rows, send notifications, or switch writers.

1. Use the same cutoff `2026-08-13T23:00:00.000Z`, the same provider accounts, and the `itrader` project scope. Export Accounts `mpdee-project-cost-comparison-v1` and the iTrader ledger view. Compare source-currency units before FX. Record code defaults, the known-project seed (`markupBps` 1000 and £0.38/day), and the stored policies that were actually read.
2. Explain every material difference as a missing event, duplicate, attribution, funding, policy, FX, rounding, infrastructure coverage, adjustment, or settlement. Do not change either total to force agreement. Unresolved rows stay visible and non-invoiceable.
3. Classify supplied source rows before importing them. A customer payment stays a payment with its settlement link. An unrelated-work credit stays a client-charge credit. A client-charge adjustment stays an adjustment. None of those are provider expenses. A one-hour offset from `2026-08-13T23:00:00.000Z`, including a naive local time read as UTC, is reported and the stored exclusive period end is left unchanged.
4. Prepare the final infrastructure and manual-adjustment delta with stable `(provider, accountRef, sourceKey)` identities. Reject Vercel-billed database rows that would also arrive as Supabase. Exclude frozen baseline ids and `vercel:membership:` rows from that delta. Replay must add zero rows.

### Final-delta import

Stop iTrader writes only after the shadow report is accepted. Export the last source window, import it once through Accounts, and replay the same payload. Counts, source units, revisions, pending requests, confirmed settlements, and approved `CostChargeSnapshot` ids must match the signed report. Frozen invoice amounts stay on their original rows.

### Single-writer switch

The iTrader preview reader already requests this comparison and keeps unapproved lines provisional. Removing iTrader's provider write path and write credentials is a separate production change. Accounts becomes the only writer after that change and the reconciliation both pass. Until that approval, both apps must not issue charges for the same cost.

### Rollback

Stop the new writer before restoring the previous one. Import any Accounts-only delta back as a reviewed iTrader adjustment, then resume iTrader writes. Do not run both writers. Rollback does not delete approved snapshots, settlements, or frozen charges.

## Cutover acceptance gates

1. Every source record in the agreed period is accounted for as imported, intentionally excluded with evidence, or held for named review; no unexplained total or count differences remain.
2. Vercel and Supabase-through-Vercel charges appear once, with separate manual costs justified against provider evidence.
3. Historical £0.38/day membership coverage, date boundaries and total reconcile exactly to the iTrader source rows, with no overlap against imported billing rows.
4. Project/client attribution, effective policies and FX are reviewed; unresolved records remain non-invoiceable.
5. The project-scoped Accounts API passes scope-isolation and read-only authorization checks.
6. Immutable approved charge snapshots reproduce the amounts and entry references used for invoice approval; existing invoice requests and settlements remain traceable.
7. A final-delta rehearsal succeeds and operations can verify that only one application is writing after cutover.

## Source notes

- `D:\Websites\iommarket\docs\costs\itrader-ledger.md` describes the canonical ledger, charge policy, Vercel membership share, FOCUS handling, manual Supabase fallback and one-writer migration principle.
- `D:\Websites\iommarket\lib\costs\sync.ts`, `classify.ts`, `vercel-membership.ts` and `app\api\internal\cost-ledger\route.ts` show the existing sync/classification, £0.38/day generation and current internal read endpoint.
- `D:\Websites\mpdee-accounts2\docs\costs\README.md` describes the preview-only ledger, import contract, current provider connector gap, no-invoicing status and the requirement for historical reconciliation, one shared Accounts API, project-scoped iTrader read credentials and removal of the independent writer.
