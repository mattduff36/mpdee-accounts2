import { unresolvedCoverageText } from './bill-coverage'
import { nativeText, outstandingLabel, type CostSummary, type ProjectFigure } from './figures'
import { unitsText } from './money'

export type IssueDraft = {
  id: string
  stableKey: string
  projectSlug: string | null
  provider: string | null
  accountRef: string | null
  periodStart: string | null
  periodEnd: string | null
  title: string
  description: string
  evidenceRef: string
  amountText: string | null
  currency: string | null
  amountUnknown: boolean
  effectOnTotals: string
  billingEffect: string
  requiredAction: string
}

export type StoredIssue = { stableKey: string; status: string; resolutionNote: string | null }

const recorded = 'Recorded on 2026-10-04 from the read-only comparison. This Accounts database does not re-query the writer, so the count is not a live writer total.'

export function mergeIssue(existing: StoredIssue | null, draft: IssueDraft) {
  return { ...draft, status: existing?.status ?? 'open', resolutionNote: existing?.resolutionNote ?? null, changesMoney: false as const }
}

export function liveIssueDrafts(summary: CostSummary): IssueDraft[] {
  const infra = summary.unassignedInfrastructure.map(nativeText).join(', ') || 'USD 0.0000000'
  const bills = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(summary.providerBillPence / 100)
  const unallocated = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(summary.unallocatedBillPence / 100)
  return [
    draft({
      id: 'unassigned-infrastructure', projectSlug: null, provider: 'vercel',
      title: 'Infrastructure charges awaiting a project',
      description: `${summary.unassignedInfrastructureRows} imported infrastructure charges have a known billed amount and no project. They are visible as unassigned provider cost and are outside every project total.`,
      evidenceRef: 'CostUsageEvent provider vercel, project unassigned, since 2026-08-13T23:00:00.000Z',
      amountText: infra, currency: 'USD', amountUnknown: false,
      effectOnTotals: 'Included in unassigned provider cost. Excluded from project provider totals and from provisional client charges.',
      billingEffect: 'Not invoiceable while unassigned.',
      requiredAction: 'Attribute each charge from its resource or project evidence, or leave it unassigned.',
    }),
    draft({
      id: 'unassigned-usage', projectSlug: null, provider: 'cursor',
      title: 'Cursor usage with no project',
      description: `${summary.unassignedCursorRows} cursor events are unassigned. Their nominal value is not verified usage of any one project.`,
      evidenceRef: 'CostUsageEvent provider cursor, project unassigned, since 2026-08-13T23:00:00.000Z',
      amountText: `USD ${unitsText(summary.projects.find(project => !project.assigned)?.usage[0]?.units ?? BigInt(0))}`, currency: 'USD', amountUnknown: false,
      effectOnTotals: 'Shown only on the unassigned figure. Not added to a project usage total.',
      billingEffect: 'Client charge is held.',
      requiredAction: 'Map a workspace or leave the events unassigned. Do not default them to iTrader.',
    }),
    draft({
      id: 'provider-bills', projectSlug: null, provider: null,
      title: 'Provider expenses awaiting documents and allocation',
      description: `${summary.providerBills} provider expenses are inside the ledger at ${bills}. ${unallocated} is still unallocated overhead. Unresolved coverage is a separate issue and is not included in this count. Invoice dates are not billing periods. VAT in the book is not a provider tax line.`,
      evidenceRef: 'Expense rows for Cursor, Vercel and Supabase since 2026-08-13',
      amountText: bills, currency: 'GBP', amountUnknown: false,
      effectOnTotals: 'Unallocated amounts stay in overhead. Allocated shares appear on the project as book GBP, separate from usage provider cost.',
      billingEffect: 'An expense share does not approve a client charge or suppress usage.',
      requiredAction: 'Provide the original invoice, provider account, service and billing period for each reference. Record metadata here, then preview an allocation.',
    }),
    draft({
      id: 'unresolved-bill-coverage', projectSlug: null, provider: 'cursor',
      title: 'Provider bill coverage is unresolved',
      description: summary.unresolvedBills.length
        ? summary.unresolvedBills.map(bill => unresolvedCoverageText(bill)).join(' ')
        : 'No provider bill is waiting on a service period.',
      evidenceRef: 'Expense notes and book date. Production Expense has no billing-period columns.',
      amountText: summary.unresolvedBills.length ? `£${(summary.unresolvedBills.reduce((total, bill) => total + bill.grossPence, 0) / 100).toFixed(2)}` : '£0.00',
      currency: 'GBP', amountUnknown: false,
      effectOnTotals: 'Omitted from the ledger bill total. Not allocated to a project.',
      billingEffect: 'Not invoiceable and not a verified exclusion.',
      requiredAction: 'Obtain the original provider invoice and record its service period. Keep the accounts-book row unchanged. Add the amount to the ledger only when that period overlaps it.',
    }),
    draft({
      id: 'free-credit', projectSlug: null, provider: 'cursor',
      title: 'Free-credit funding is unresolved',
      description: `${summary.freeCreditRows} events use unknown or free-credit funding. Their recorded provider amount is separate from confirmed on-demand cash.`,
      evidenceRef: 'CostUsageRevision.funding unknown or free-credit',
      amountText: collapse(summary.freeCredit).map(nativeText).join(', ') || 'USD 0.0000000', currency: 'USD', amountUnknown: false,
      effectOnTotals: 'Shown as free-credit recorded charge. Excluded from confirmed provider cash and from the provisional client charge.',
      billingEffect: 'Not invoiceable until funding is classified.',
      requiredAction: 'Classify each event as a reviewed credit or confirmed cash from provider evidence. Do not treat it as on-demand by default.',
    }),
    draft({
      id: 'missing-nominal', projectSlug: null, provider: 'cursor',
      title: 'Usage events with no nominal amount',
      description: `${summary.missingNominalRows} cursor events have no totalCents. The missing amount is unknown. Known nominals on other events stay visible.`,
      evidenceRef: 'CostUsageRevision.nominalUnits is null',
      amountText: null, currency: null, amountUnknown: true,
      effectOnTotals: 'Those events are omitted from the usage subtotal and counted beside it.',
      billingEffect: 'Client charge is held for those events.',
      requiredAction: 'Recover totalCents from the provider export. Do not invent a nominal from the event time.',
    }),
    draft({
      id: 'fx-limits', projectSlug: null, provider: null,
      title: 'Reference FX is an estimate',
      description: `${summary.usageRowsWithStoredFx} usage rows store a paid GBP rate. A reference rate used on screen is an estimate. Expense and payment currency stays the book currency, which is GBP pence, whether or not a usage row has a rate.`,
      evidenceRef: 'CostUsageRevision.fxGbp and Expense grossAmount',
      amountText: null, currency: null, amountUnknown: true,
      effectOnTotals: 'Native USD totals are unchanged by the estimate. Estimated GBP is not an outstanding balance.',
      billingEffect: 'An estimate cannot approve a charge.',
      requiredAction: 'Keep estimates labelled. Do not infer a payment currency from usage FX.',
    }),
  ]
}

export function recordedIssueDrafts(): IssueDraft[] {
  return [
    draft({
      id: 'material-amounts', projectSlug: 'itrader', provider: 'cursor',
      title: 'Material amount conflicts',
      description: `Some event identities disagree by more than quantization. Neither source is selected. ${recorded}`,
      evidenceRef: 'Local shadow comparison, material amount conflicts',
      amountText: null, currency: 'USD', amountUnknown: true,
      effectOnTotals: 'The local ledger keeps the Accounts nominal. The writer figure is not written back. These rows are not added to the quantization or funding counts.',
      billingEffect: 'Provisional only. Conflict review does not make a charge invoiceable.',
      requiredAction: 'Compare each identity with the original provider event. Do not upsert the writer.',
    }),
    draft({
      id: 'funding-conflicts', projectSlug: 'itrader', provider: 'cursor',
      title: 'Funding conflicts',
      description: `Accounts treats INCLUDED_IN_PRO and INCLUDED_IN_PRO_PLUS as included. The writer leaves them unresolved and the writer client charge is zero. Do not add the two lists. ${recorded}`,
      evidenceRef: 'Local shadow comparison, funding conflicts',
      amountText: null, currency: 'USD', amountUnknown: true,
      effectOnTotals: 'Local funding stays included. The writer client charge is not imported as a correction.',
      billingEffect: 'Provisional. Resolving this issue does not change funding.',
      requiredAction: 'Decide the funding label from the provider kind. Apply it only through an explicit correction preview.',
    }),
    draft({
      id: 'quantization', projectSlug: 'itrader', provider: 'cursor',
      title: 'Quantization residuals',
      description: `Some identities differ by one quantized increment after the writer rounds cents. An identity that is also a funding conflict is not counted twice. ${recorded}`,
      evidenceRef: 'Local shadow comparison, quantization residuals',
      amountText: 'One quantized increment', currency: 'USD', amountUnknown: false,
      effectOnTotals: 'The residual stays visible. It is not added to the material conflicts.',
      billingEffect: 'No billing change.',
      requiredAction: 'No rewrite. Keep the Accounts nominal.',
    }),
    draft({
      id: 'writer-only-events', projectSlug: 'itrader', provider: 'cursor',
      title: 'Writer events absent from this ledger',
      description: `The writer had events this ledger did not, including same-day collector lag and free-credit rows. ${recorded} Automatic collection is not running.`,
      evidenceRef: 'Local shadow comparison, writer-only events',
      amountText: null, currency: 'USD', amountUnknown: true,
      effectOnTotals: 'Absent from local usage and provider totals.',
      billingEffect: 'Not invoiceable from this ledger.',
      requiredAction: 'Import a local evidence pack with the refresh command when a sanitized export is available. Do not read the iTrader checkout to do it.',
    }),
    draft({
      id: 'quarantined-snapshots', projectSlug: null, provider: 'vercel',
      title: 'Quarantined infrastructure snapshots',
      description: `Some writer snapshots were quarantined and had no charge line. They are rejected evidence. They are not a second copy of the imported charges, and they are not reversals that match a prior charge. ${recorded}`,
      evidenceRef: 'Local shadow comparison, quarantined snapshots',
      amountText: null, currency: null, amountUnknown: true,
      effectOnTotals: 'Excluded from imported provider cost. No second copy of the imported charges.',
      billingEffect: 'Not invoiceable.',
      requiredAction: 'Leave them out unless a later export shows a charge on the same bucket.',
    }),
    draft({
      id: 'payment-linkage', projectSlug: null, provider: null,
      title: 'Payment linkage is not established',
      description: 'A payment credit was counted once. Sharing a client with the project is not a project link. The payment is not deducted from a project balance.',
      evidenceRef: 'src/lib/costs/historical-reconcile.ts reviewInvoiceCredit',
      amountText: null, currency: 'GBP', amountUnknown: true,
      effectOnTotals: 'Not deducted from project outstanding. Outstanding stays not established while no approved charge exists.',
      billingEffect: 'Does not settle a project charge.',
      requiredAction: 'Original evidence that this payment belongs to the project. Do not relink the payment from this page.',
    }),
    draft({
      id: 'extra-adjustment', projectSlug: 'itrader', provider: null,
      title: 'Possible client-charge duplication',
      description: 'A client-charge adjustment has no evidence that it duplicates usage. It is not counted as a duplicate.',
      evidenceRef: 'src/lib/costs/historical-reconcile.ts reviewClientAdjustment',
      amountText: null, currency: 'GBP', amountUnknown: true,
      effectOnTotals: 'Left unresolved. Not removed from either source.',
      billingEffect: 'Not a credit against a client charge.',
      requiredAction: 'Evidence that the adjustment is a duplicate or a distinct charge.',
    }),
    draft({
      id: 'naive-timestamps', projectSlug: null, provider: 'vercel',
      title: 'Infrastructure timestamps have no time zone',
      description: 'FOCUS period digits were stored with a Z suffix and no hour shift. A missing time zone is not evidence for a one-hour correction.',
      evidenceRef: 'src/lib/costs/historical-reconcile.ts refuseNaiveTimezoneCorrection',
      amountText: null, currency: null, amountUnknown: true,
      effectOnTotals: 'Stored periods are unchanged.',
      billingEffect: 'No billing change.',
      requiredAction: 'A source timestamp that includes a time zone before any period is moved.',
    }),
  ]
}

export function projectIssues<T extends { projectSlug: string | null }>(issues: T[], slug: string) {
  return issues.filter(issue => issue.projectSlug === slug || issue.projectSlug === null)
}

export function figureScopeNote(project: ProjectFigure) {
  if (!project.assigned) return 'Unassigned usage and infrastructure stay outside every project total.'
  return `${project.name} includes assigned events only. Unassigned work and unallocated overhead are not part of this total. Outstanding ${outstandingLabel(project.outstandingPence)}.`
}

function collapse(totals: { currency: string; units: bigint; rows: number; missing: number }[]) {
  const sums = new Map<string, { currency: string; units: bigint; rows: number; missing: number }>()
  for (const total of totals) {
    const current = sums.get(total.currency) ?? { currency: total.currency, units: BigInt(0), rows: 0, missing: 0 }
    current.units += total.units
    current.rows += total.rows
    sums.set(total.currency, current)
  }
  return Array.from(sums.values())
}

function draft(input: Omit<IssueDraft, 'stableKey' | 'accountRef' | 'periodStart' | 'periodEnd'> & { accountRef?: string | null; periodStart?: string | null; periodEnd?: string | null }): IssueDraft {
  return { stableKey: input.id, accountRef: null, periodStart: '2026-08-13T23:00:00.000Z', periodEnd: null, ...input }
}
