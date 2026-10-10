# Global and project cost calculation settings

## Current calculation

The central rule is `CHARGE_RULE_VERSION = mpdee-global-client-charge-v2`.
Open `/costs/settings` to save global defaults. Open `/costs/projects` to override individual fields for a project.

| Setting | Initial default | Basis |
| --- | --- | --- |
| Included premium usage | 50% | Standard nominal value of included premium Cursor usage |
| Included Grok and Composer usage | 0% | Standard nominal value of included Grok/Composer usage |
| All on-demand usage | 100% | Recorded provider charge, including Grok and Composer |
| Daily Vercel hosting charge | £0.00 | Additional GBP charge excluding VAT, enabled separately per project |

Other eligible infrastructure is charged at its recorded amount. A daily hosting fee adds to actual Vercel costs; it does not replace them.

Percentages and GBP inputs support two decimal places. Percentages are stored as integer basis points, daily hosting as integer pence. Blank global inputs are invalid. Each project field either inherits the global default (`null`) or stores an explicit override. Zero is an override, not inheritance.

Saving rates recalculates historical cost reports using the current settings. Source usage, provider charges, import revisions, invoices, payments and approved snapshots are not rewritten. A changed global value affects only project fields still inheriting it. Saves require write access, reject stale revisions and record before/after audit details atomically.

## Chargeable dates and hosting schedules

Existing `CostPolicy` records retain their billable flag and effective date ranges. Project date ranges take precedence, with client date ranges as fallback. An effective nonbillable range produces zero source client charge; missing date coverage holds it. The source provider cash and nominal usage remain evidence.

The old `CostPolicy` percentage and daily amount columns remain historical data. They do not set current prices. Use Calculation setup and Project calculation rates for prices, and Chargeable dates for source eligibility.

A project must separately enable its daily hosting fee and provide a start date. The end date is optional. Days are inclusive UTC dates, clipped to the report window and today/as-of date. A blank end continues through the current reporting date; future days are never accrued. Disabling the fee removes it from recalculated reports while preserving the saved rate and schedule. A zero resolved daily rate generates no fee.

Hosting schedules apply independently of source chargeable dates. Fees appear as separate calculated adjustments, including days with no source usage. They do not create provider events, provider cash, imports or nominal usage. A fee does not establish complete provider coverage. Project snapshots and billing retain the existing shared ledger start; earlier schedule dates are included only in reports whose coverage contains those days.

## Model and source handling

Included Grok and Composer use exact family names and Cursor-prefixed/versioned aliases, case-insensitively: `(cursor-)?(grok|composer)(-...)`. Examples include `grok-4` and `cursor-composer-2`.

Included usage with an empty, default, auto, unknown or unspecified model remains held. Unknown funding remains unavailable. Free and free-credit funding remain excluded. Explicit provider-invoice coverage and synthetic provider membership rows stay excluded from duplicate client charging. The separately configured hosting fee is not a provider membership import.

GBP conversion uses the dated rate for each event. A rate stored with that event takes precedence over reference quotes. Reference FX remains an estimate, and missing FX remains unavailable with explicit coverage counts. Saving calculation settings does not fabricate or overwrite exchange rates.

## Reports and balances

Overview, native project figures, estimates, project summaries, snapshots, billing history, monthly ledger responses and export adjustments use the resolved settings. Source counts, held counts and monetary availability remain distinct from known calculated hosting fees. Charts include fee-only dates without inventing provider cash or hiding missing source amounts.

The cost-versus-invoices report uses linked invoice totals excluding VAT for this version. Remaining to invoice is recorded project costs minus net invoiced amounts. Payments are not subtracted again. Approved outstanding remains a separate approved-charge/settlement figure.

Current cost estimates remain provisional. Frozen legacy charges and approved snapshots are retained. Historical provider bills with unverified service periods stay available for review; their accounts-book gross is not automatically a client cost.

## API compatibility

Existing project contracts remain in place:

- `/api/costs/projects/{slug}/comparison`: `mpdee-project-cost-comparison-v1`, with the existing `mpdee-comparison-policy-v1` wire label.
- `/api/costs/projects/{slug}/snapshot`: `mpdee-project-cost-snapshot-v2`.
- `/api/costs/projects/{slug}/summary`: `mpdee-project-cost-summary-v1`, with the current `pricingRuleVersion`.
- `/api/costs/projects/{slug}/billing`: the existing billing contract.
- Monthly ledger responses remain provisional; source exports include a separate calculated-adjustments collection.

Daily fees use the existing `VERCEL_HOSTING` category with the label “Daily hosting fee” and zero imported events. Source coverage is not inflated. Configuration revisions participate in calculation/snapshot revisions without pretending that source imports were refreshed.

Project API reads use the existing distinct bearer-token hash map `COSTS_PROJECT_READ_TOKEN_SHA256_BY_SLUG`. Missing/bad tokens return 401, missing configuration 503, unavailable projects 404, and calculation failures generic errors. Administrator cookies and ingest credentials do not grant these project-token reads. Responses remain private and uncached.

The iTrader local staging reader consumes Accounts costs and invoice balances. These settings preserve its existing DTO validation and do not deploy or redesign iTrader. Production rollout status belongs in release records.
