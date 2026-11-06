# Development subscription allocation preview v1

`previewDevelopmentAllocation` in
`src/lib/costs/development-allocation-preview.ts` is a pure, bounded policy,
version `mpdee-development-allocation-preview-v1`. It never calls or modifies
legacy Cursor allocation, imports records, writes financial data or applies a
split. Existing `mpdee-subscription-v1` imports and acknowledgements are unchanged.

The authenticated `/costs/subscriptions` page invokes the policy **without
evidence**, showing the entire original native gross invoice as unallocated,
with an explicit reason. There is no evidence auto-selection or apply action.
The owner's ChatGPT invoice remains wholly unallocated pending review. The
library can evaluate hypothetical evidence; neither provisional nor reviewed
preview labels approve an allocation, change stored status or authorize charging.

## Evidence contract and denominator

The optional strict `mpdee-development-allocation-evidence-v1` input contains:

- `review`: `provisional`, or `reviewed` with an opaque `reference`.
- `coverage`: `partial`, `unknown`, or `complete-verified` with an opaque
  account-wide verification `reference`.
- `weights`: at most 1,000 non-overlapping bucket measurements. A bucket is
  `{kind: "project", projectId}`, `{kind: "personal"}` or `{kind: "unassigned"}`.
  There is one total per bucket; duplicate evidence references are rejected.
- Optional `accountDenominator`: an **independently measured whole-account**
  total, with a distinct evidence reference. Never construct it by summing just
  the known project subset.

Each measurement has `scope`, `basis: "provider-reported-value"`,
`decimalPlaces` (0-9), an unsigned integer-string `weight` (at most 30 digits)
and an opaque `evidenceRef`. Scope contains `provider` (`openai` or `codex`),
`accountRef`, `currency` (`USD`, `GBP` or `EUR`), `periodStart` and exclusive
`periodEnd`. Every scope must exactly match the invoice, and every measurement
must use the same decimal scale and comparable provider monetary valuation.
The invoice input is `{scope, grossMinor}`, with integer native minor units
from 0 to 2,000,000,000. Reference and project identifiers use ASCII letters,
digits, underscores and hyphens, up to 160 characters.

No account denominator **and** no complete verified account coverage means the
**entire bill remains unallocated**, even with known project measurements.
Verified complete coverage permits the sum of all buckets as denominator; if an
independent denominator is also supplied, the totals must reconcile exactly.
Partial/unknown coverage with an independent denominator preserves
`denominator - known weights` as an explicit unmeasured residual. Personal and
measured-but-unassigned usage remain separate buckets, never project weights.
Zero/absent bucket measurements cannot establish a project share. Invalid
evidence throws; missing evidence returns an explicitly inactive preview.

The split uses exact BigInt ratios and largest-remainder rounding over all
buckets **including residual**, breaking ties by ASCII bucket key. Reordering
input does not change results. Integer shares always conserve original native
gross including personal, unassigned and unallocated amounts. Tiny positive
weights/residuals can round to zero minor units; `unmeasuredWeight` retains the
exact residual independently of rounding. No FX or GBP estimate is allocated.

## Effective dates, funding and overlapping evidence

This capability introduces no retrospective allocation or assumed policy
effective date. Evidence must cover the exact invoice service interval (UTC
calendar dates, end exclusive); source observation/import dates do not extend
coverage. A future reviewed policy adoption must explicitly record its effective
service periods and evidence version, not silently backfill earlier invoices.

Allowances, allowance percentages, messages and mixed raw model token counts
are never allocation weights. Do not aggregate providers, accounts, currencies,
scales, model-specific token units or overlapping daily/task evidence. The pure
function validates structural comparability; the reviewer must establish
source truth, non-overlap and complete account coverage where claimed.

Grant funding is a funding source, not a paid charge, discount inferred from
tokens, or evidence of subscription-funded usage. Any proposed subscription
weight requires separate proof that the comparable usage belongs to that
subscription; separately billed, grant-funded and unresolved consumption must
not be silently relabelled as subscription consumption.

Prepaid purchases establish cash/payment evidence; consumption draws down that
balance and is not another purchase. Do not add purchase and consumption as two
charges, or allocate both a prepaid purchase and an overlapping subscription
invoice to the same consumption. Reconciliation, owner approval and any future
accounting treatment remain separate work; this preview has no such write path.
