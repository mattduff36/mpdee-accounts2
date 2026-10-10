import { excludedFromClientAndConfirmedCash, isFreeCredit, showsConfirmedProviderCash } from './charge-eligibility'
import type { CalculationRates } from './calculation-settings'
import { COMPARISON_POLICY } from './comparison-policy'
import { chargeUnits, UNIT, unitsText, type Policy } from './money'
import { resolvePolicy, type DatedPolicy } from './service'

export { isConfirmedProviderCash, isFreeCredit } from './charge-eligibility'

export type UsageGroup = {
  slug: string
  name: string
  provider: string
  funding: string
  currency: string
  quality: string
  assigned: boolean
  model: string | null
  sourceKey: string
  coveredByProviderInvoice: boolean
  rows: number
  /** Per-event nominal. Null stays unknown and is never treated as zero. */
  nominalUnits: bigint | null
  /** Per-event provider cash. Null stays unknown and is never treated as zero. */
  providerUnits: bigint | null
  /**
   * Dated source policy from a production read.
   * Omitted callers keep the historical always-billable charge.
   * `uncovered` holds the client charge. `nonbillable` is a known zero.
   */
  sourceEligibility?: 'billable' | 'nonbillable' | 'uncovered'
}

export type MoneyTotal = { currency: string; units: bigint; rows: number; missing: number }

export type ProjectFigure = {
  slug: string
  name: string
  assigned: boolean
  usage: MoneyTotal[]
  confirmedProvider: MoneyTotal[]
  freeCredit: MoneyTotal[]
  provisionalCharge: MoneyTotal[]
  heldRows: number
  allocatedExpensePence: number
  outstandingPence: number | null
}

export type CostSummary = {
  projects: ProjectFigure[]
  unassignedInfrastructureRows: number
  unassignedInfrastructure: MoneyTotal[]
  unassignedCursorRows: number
  freeCreditRows: number
  freeCredit: MoneyTotal[]
  missingNominalRows: number
  providerBills: number
  providerBillPence: number
  unallocatedBillPence: number
  unresolvedBills: { reference: string; grossPence: number; booked: string; sourceDate: string | null }[]
  usageRowsWithStoredFx: number
}

const empty = (currency: string): MoneyTotal => ({ currency, units: BigInt(0), rows: 0, missing: 0 })

function add(list: MoneyTotal[], currency: string, units: bigint, rows: number, missing = 0) {
  const current = list.find(item => item.currency === currency) ?? empty(currency)
  if (!list.includes(current)) list.push(current)
  current.units += units
  current.rows += rows
  current.missing += missing
}

/** Known per-event amounts multiply by count. A missing amount increments the unknown count only. */
function addAmount(list: MoneyTotal[], currency: string, perEvent: bigint | null, rows: number) {
  if (perEvent === null) add(list, currency, BigInt(0), 0, rows)
  else add(list, currency, perEvent * BigInt(rows), rows)
}

/** Keep each source currency. Do not fold a missing amount into the first currency as zero. */
export function totalsByCurrency(entries: { currency: string; rows: number; units: bigint | null }[]): MoneyTotal[] {
  const totals: MoneyTotal[] = []
  for (const entry of entries) addAmount(totals, entry.currency, entry.units, entry.rows)
  return totals.sort((a, b) => a.currency.localeCompare(b.currency))
}

export type ApprovedSnapshotTotal = {
  id: string
  projectId: string
  replacesSnapshotId: string | null
  clientChargePence: number | null
}

/**
 * Approved replacements supersede the snapshot they name.
 * A project with no remaining approved pence is omitted so the caller can keep outstanding null.
 */
export function currentApprovedTotals(rows: ApprovedSnapshotTotal[]): { projectId: string; approvedPence: number }[] {
  const replaced = new Set(rows.flatMap(row => row.replacesSnapshotId ? [row.replacesSnapshotId] : []))
  const totals = new Map<string, number>()
  for (const row of rows) {
    if (replaced.has(row.id) || row.clientChargePence === null) continue
    totals.set(row.projectId, (totals.get(row.projectId) ?? 0) + row.clientChargePence)
  }
  return Array.from(totals, ([projectId, approvedPence]) => ({ projectId, approvedPence }))
}

export type ProjectHostingFee = { slug: string; name: string; amountPence: number; days: number }

function pricedPolicy(rates: CalculationRates | undefined): Policy {
  if (!rates) return COMPARISON_POLICY
  return { billable: true, includedBaseBps: COMPARISON_POLICY.includedBaseBps, markupBps: COMPARISON_POLICY.markupBps, infrastructureMarkupBps: COMPARISON_POLICY.infrastructureMarkupBps, rates }
}

function hostingUnits(amountPence: number): bigint {
  if (!Number.isSafeInteger(amountPence) || amountPence < 0) throw new Error('Hosting fee total is not a safe integer')
  return BigInt(amountPence) * UNIT / BigInt(100)
}

/** Assigned events resolve project policy, then a client policy. Unassigned events omit eligibility. */
export function sourceEligibilityFor(policies: DatedPolicy[], projectId: string | null, clientId: string | null, occurredAt: Date): UsageGroup['sourceEligibility'] {
  if (!projectId) return undefined
  const policy = resolvePolicy(policies, projectId, clientId, occurredAt)
  if (!policy) return 'uncovered'
  return policy.billable ? 'billable' : 'nonbillable'
}

/** Same monetary identity stays one group. Eligibility splits a group only when the dated policy differs. Amounts stay per event. */
export function groupSourceUsage(rows: Omit<UsageGroup, 'rows'>[]): UsageGroup[] {
  const grouped = new Map<string, UsageGroup>()
  for (const row of rows) {
    const key = [
      row.slug, row.name, row.provider, row.funding, row.currency, row.quality, String(row.assigned), row.model ?? '',
      row.sourceKey, String(row.coveredByProviderInvoice), row.nominalUnits?.toString() ?? '', row.providerUnits?.toString() ?? '',
      row.sourceEligibility ?? '',
    ].join('\0')
    const current = grouped.get(key)
    if (current) current.rows += 1
    else grouped.set(key, { ...row, rows: 1 })
  }
  return Array.from(grouped.values())
}

/** Project totals contain assigned work only. Unassigned rows stay on their own figure. */
export function summariseProjects(
  groups: UsageGroup[],
  snapshots: { slug: string; approvedPence: number | null }[],
  allocated: { slug: string; pence: number }[],
  options?: { ratesBySlug?: ReadonlyMap<string, CalculationRates>; hostingFees?: ProjectHostingFee[] },
): ProjectFigure[] {
  const bySlug = new Map<string, ProjectFigure>()
  const figure = (group: UsageGroup) => {
    const current = bySlug.get(group.slug) ?? {
      slug: group.slug, name: group.name, assigned: group.assigned, usage: [], confirmedProvider: [], freeCredit: [], provisionalCharge: [],
      heldRows: 0, allocatedExpensePence: 0, outstandingPence: null,
    }
    bySlug.set(group.slug, current)
    return current
  }
  for (const group of groups) {
    const row = figure(group)
    if (group.provider === 'cursor') addAmount(row.usage, group.currency, group.nominalUnits, group.rows)
    if (isFreeCredit(group.funding)) addAmount(row.freeCredit, group.currency, group.providerUnits, group.rows)
    else if (showsConfirmedProviderCash(group)) addAmount(row.confirmedProvider, group.currency, group.providerUnits, group.rows)
    if (isFreeCredit(group.funding) || excludedFromClientAndConfirmedCash(group)) continue
    if (group.sourceEligibility === 'uncovered' || !group.assigned || group.quality !== 'complete') {
      row.heldRows += group.rows
      continue
    }
    const priced = pricedPolicy(options?.ratesBySlug?.get(group.slug))
    const policy = group.sourceEligibility === 'nonbillable' ? { ...priced, billable: false } : priced
    const perEvent = chargeUnits({ provider: group.provider, funding: group.funding, nominal: group.nominalUnits, cash: group.providerUnits, model: group.model }, policy)
    if (perEvent === null) row.heldRows += group.rows
    else addAmount(row.provisionalCharge, group.currency, perEvent, group.rows)
  }
  for (const fee of options?.hostingFees ?? []) {
    if (fee.days === 0 || fee.amountPence === 0) continue
    const row = bySlug.get(fee.slug) ?? {
      slug: fee.slug, name: fee.name, assigned: true, usage: [], confirmedProvider: [], freeCredit: [], provisionalCharge: [],
      heldRows: 0, allocatedExpensePence: 0, outstandingPence: null,
    }
    bySlug.set(fee.slug, row)
    add(row.provisionalCharge, 'GBP', hostingUnits(fee.amountPence), fee.days)
  }
  for (const snapshot of snapshots) {
    const row = bySlug.get(snapshot.slug)
    if (row) row.outstandingPence = snapshot.approvedPence
  }
  for (const share of allocated) {
    const row = bySlug.get(share.slug)
    if (row?.assigned) row.allocatedExpensePence += share.pence
  }
  return Array.from(bySlug.values()).sort((a, b) => Number(a.assigned) - Number(b.assigned) || a.name.localeCompare(b.name))
}

export function nativeText(total: MoneyTotal) {
  if (total.rows === 0 && total.missing > 0) return `${total.currency} unavailable`
  return `${total.currency} ${unitsText(total.units)}`
}

export function outstandingLabel(pence: number | null) {
  if (pence === null) return 'Not established'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100)
}
