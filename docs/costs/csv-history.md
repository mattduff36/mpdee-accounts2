# Cursor CSV history

The Costs import page accepts original Cursor dashboard CSV exports for one explicitly selected account. This path stores source evidence in `CostUsageEvidence`, separately from `CostUsageEvent` and monetary revisions. It never creates expenses, invoices, project charges or provider cost totals.

The CSV lacks conversation/workspace identifiers and precise nominal/provider monetary values. Its displayed cost is retained as text, including `Included`, `Free` and numeric strings. Numeric display values are not treated as actual cash spending. The account email is an operator-supplied label, not authenticated provider identity.

Imports require an authenticated user with write access and a matching Origin header. CSV structure, UTC timestamps, token counts and bounded field lengths are validated before an atomic import. Duplicate fingerprints are unique per account and independent of filename or row order. Distinct token evidence at the same timestamp/model remains distinct. Original source filename and content hash are stored with each new record. Raw files and credentials are never committed.

The overview shows all-date CSV coverage separately from filtered financial figures. The import page shows the latest 50 recovered records. No project assignment is guessed from dates or account names.

Canonical collector imports continue to create the financial ledger. Separate CSV evidence cannot double-count financial amounts. Explicit linking to canonical events is reserved for later verified account bindings and unique event/token matches; no automated link or reconciliation completion is claimed by this first version. An unlinked CSV row remains evidence awaiting project and precise monetary information.

Verification for the September 2026 recovery includes parsing the actual Gmail and Hotmail exports, authenticated imports, full replay with zero additions, and a fingerprint comparison of all pre-existing financial events and revisions. Test results must be recorded after execution, not inferred from the parser alone.
