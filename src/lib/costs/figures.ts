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
  rows: number
  nominalUnits: bigint
  providerUnits: bigint
  missingNominal: number
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
  return funding === 'unknown' || funding === 'free-credit'
}

export function isConfirmedProviderCash(provider: string, funding: string) {
  if (isFreeCredit(funding) || funding === 'included') return false
  return (provider === 'cursor' && funding === 'on-demand') || funding === 'infrastructure'
}

function add(list: MoneyTotal[], currency: string, units: bigint, rows: number, missing = 0) {
  const current = list.find(item => item.currency === currency) ?? empty(currency)
  if (!list.includes(current)) list.push(current)
  current.units += units
  current.rows += rows
  current.missing += missing
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
    if (group.provider === 'cursor') add(row.usage, group.currency, group.nominalUnits, group.rows - group.missingNominal, group.missingNominal)
    if (isFreeCredit(group.funding)) add(row.freeCredit, group.currency, group.providerUnits, group.rows)
    else if (isConfirmedProviderCash(group.provider, group.funding)) add(row.confirmedProvider, group.currency, group.providerUnits, group.rows)
    const charge = group.assigned && group.quality === 'complete' && !isFreeCredit(group.funding)
      ? chargeUnits({ provider: group.provider, funding: group.funding, nominal: group.nominalUnits, cash: group.providerUnits }, COMPARISON_POLICY)
      : null
    if (charge === null) row.heldRows += group.rows
    else {
      add(row.provisionalCharge, group.currency, charge, group.rows - group.missingNominal)
      row.heldRows += group.missingNominal
    }
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
  return `${total.currency} ${unitsText(total.units)}`
}

export function outstandingLabel(pence: number | null) {
  if (pence === null) return 'Not established'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100)
}
