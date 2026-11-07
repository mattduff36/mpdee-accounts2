# Worker Live cost dashboard

`GET /api/costs/dashboard?period=this-month|last-month|this-quarter|this-year`
returns category cards, editable monthly commitments, projects and source-level
allocation revisions. Calendar periods use Europe/London. Confirmed totals use
invoice dates; Projected means the full expected period total including confirmed
bills, never an additional amount to add to Confirmed.

Forecasts use existing invoice service-period rates or current monthly commitments
(prorated for their effective dates). Usage run rates use evidenced expenditure
only. Nominal grant value and overlapping task measurements are not added to
subscription totals. Missing currency conversion evidence is unavailable, not zero.
GBP conversions are reference estimates, not proof of the actual bank exchange rate.

POST accepts only category, categorize, custom, bill and allocation operations.
The existing ingest bearer is explicitly authorised for these operations on this
endpoint only. Normal signed users require write access and same-origin POSTs.
Other cost API permissions remain unchanged. The local viewer forwards to this
fixed endpoint server-side; it never gives the ingest credential to browser code.

Categories, source membership and owner-recorded custom bills are stored in the
isolated CostDashboardSettings row with optimistic revisions and audited changes.
Custom edits reuse the existing recurring records and their revision history.
Project splits reuse audited manual allocations and do not create another cost.
Recording a bill does not create an expense, client invoice or payment. Category
and custom edits are atomic. Invalid/conflicting requests leave data unchanged.

The migration creates one new table only. It does not backfill or rewrite source
invoices, usage, legacy data, expenses, payments or approved client charges.
