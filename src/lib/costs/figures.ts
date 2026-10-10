import { COMPARISON_POLICY } from './comparison-policy'
import { chargeUnits, unitsText } from './money'

export type UsageGroup = {
  slug: string
  name: string
  provider: string
  funding: string
  currency: string
  quality: string
  assigned: boolean
  model: string | null
  rows: number
  /** Per-event nominal. Null stays unknown and is never treated as zero. */
  nominalUnits: bigint | null
  /** Per-event provider cash. Null stays unknown and is never treated as zero. */
  providerUnits: bigint | null
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

export function isFreeCredit(funding: string) {
  return funding === 'free-credit'
}

export function isConfirmedProviderCash(provider: string, funding: string) {
  if (isFreeCredit(funding) || funding === 'included' || funding === 'unknown') return false
  return (provider === 'cursor' && funding === 'on-demand') || funding === 'infrastructure'
}

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

/** Project totals contain assigned work only. Unassigned rows stay on their own figure. */
export function summariseProjects(groups: UsageGroup[], snapshots: { slug: string; approvedPence: number | null }[], allocated: { slug: string; pence: number }[]): ProjectFigure[] {
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
    else if (isConfirmedProviderCash(group.provider, group.funding)) addAmount(row.confirmedProvider, group.currency, group.providerUnits, group.rows)
    if (isFreeCredit(group.funding)) continue
    const perEvent = group.assigned && group.quality === 'complete'
      ? chargeUnits({ provider: group.provider, funding: group.funding, nominal: group.nominalUnits, cash: group.providerUnits, model: group.model }, COMPARISON_POLICY)
      : null
    if (perEvent === null) row.heldRows += group.rows
    else addAmount(row.provisionalCharge, group.currency, perEvent, group.rows)
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
