# Cost experience implementation — 28 September 2026

Approved brief: GBP-first understandable costs; one project/source/rate matrix;
evidence-rich attribution; invoice cost bars; business and client analysis.

## Agreed rules

- Project cost means actual spending plus an allocated share of actual subscription bills.
- Client charge estimates and included nominal AI value are separate from spending.
- Infer invoice project/service periods only from clear evidence; review exceptions.
- Local conversation content may be read to generate sanitized task summaries. Raw prompts and credentials stay local.
- Preserve original currencies and expose the conversion source/date. Missing data is not zero.
- Do not double-count expenses, usage events, subscription shares or overlapping invoice periods.

## Primary work

- [x] GBP conversion provenance, clear ledger explanations and shared costs navigation.
- [x] Editable project matrix with explicit saving/results, source linking and effective-dated rates.
- [x] Grouped review with sanitized task context and explainable attribution suggestions.
- [x] Explicit invoice associations and conserved expense/subscription allocation.
- [x] Invoice cost bars and trends/client analysis with completeness indicators.
- [x] Meaningful calculation tests, isolated mutation checks, desktop/mobile Chrome verification.

## Follow-up queue

Record incidental defects here while doing primary work. Review and resolve quick fixes afterwards;
document larger risks or dependencies rather than silently expanding financial behavior.

- [x] Fix misshapen mark-invoice-paid confirmation modal; inspect overlay containment/focus/mobile sizing.
- [x] Existing Profit & Loss labels mix paid invoice totals and dated gross expenses; align or clearly distinguish cashflow and profitability.
- [x] Existing Sales by Month attributes paid amounts to issue month; clarify invoice cohort vs actual receipt date.
- [x] Import coverage label must distinguish a complete fetched window from a complete billing period.

## Release evidence

- 133 application tests passed; 3 environment-dependent tests skipped. 20 collector tests passed.
- TypeScript and production build passed against isolated localhost PostgreSQL.
- Additive migration applied successfully to a fresh production snapshot on localhost.
- Chrome desktop/mobile checks covered ledger, matrix, analysis, review and payment modal; checked pages had no viewport overflow.
- Real local invoice-association and expense-share saves produced audit records in the isolated database only. Matrix saved 29 verified project connections and 27 source links atomically in that copy.
- Real sanitized import added context to 74 existing revisions. Replay was duplicate-only; original monetary values and attribution were unchanged.
- No synthetic invoice, payment or expense was created in production.

## Additional follow-ups resolved

- [x] Client totals included draft/cancelled invoices; now excluded from financial summaries.
- [x] Payment refunds displayed inconsistently; signed values and totals now agree.
- [x] Missing client cost allocations looked like zero cost; now clearly unavailable.
- [x] Fully credited invoices lost their incurred costs; allocation keeps original revenue weights.
- [x] Credit-note-only clients were missing from annual analysis; now included.
- [x] Date-range descriptions expanded to whole months; explicit day ranges are preserved and ambiguity held.
- [x] Oversized FX fetch exceeded Next cache limit; only the parsed reporting year is cached.
- [x] Review-page encoding issue found by browser verification; repaired and all changed files checked as valid UTF-8.

## Explicit remaining boundaries

Invoice associations currently support one project per invoice. Multi-project invoices require a future reviewed split. Full historical subscription allocations need complete billing-period evidence; imported-window allocations remain provisional. Existing project overrides cannot yet be ended to resume client inheritance without a future explicit end-date model. No iTrader writer cutover, provider billing connector, or invoicing automation was added in this release.
