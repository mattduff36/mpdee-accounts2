import { allocateSubscriptionExpense, type AllocationEvent } from './subscription-allocation'

export type BillService = 'subscription' | 'on-demand' | 'infrastructure' | 'membership'

export type ProviderBill = {
  id: string
  provider: string
  accountRef: string | null
  service: BillService
  periodStart: string
  periodEnd: string
  netPence: number
}

export type BillUsage = {
  id: string
  provider: string
  accountRef: string
  funding: string
  occurredAt: string
  projectId: string | null
  nominalUnits: bigint | null
  providerUnits: bigint | null
  quality: string
  currency: string
}

export type BillMatch = {
  allocations: { billId: string; projectId: string; pence: number; method: string }[]
  unallocated: { billId: string; pence: number; reason: string }[]
  suppressedEventIds: string[]
  retainedOverheadPence: number
}

function inPeriod(occurredAt: string, bill: ProviderBill) {
  return occurredAt >= bill.periodStart && occurredAt < bill.periodEnd
}

function sameAccount(event: BillUsage, bill: ProviderBill) {
  return Boolean(bill.accountRef) && event.provider === bill.provider && event.accountRef === bill.accountRef
}

/** Trace a provider bill to usage. Usage is suppressed only when that bill covers the same account, service and period. */
export function matchProviderBills(bills: ProviderBill[], events: BillUsage[]): BillMatch {
  const allocations: BillMatch['allocations'] = []
  const unallocated: BillMatch['unallocated'] = []
  const suppressed = new Set<string>()
  let retainedOverheadPence = 0
  for (const bill of bills) {
    if (!Number.isInteger(bill.netPence)) throw new Error('Bill amount must be integer pence.')
    if (bill.periodEnd <= bill.periodStart) throw new Error('Exclusive period end must be later than the start.')
    if (bill.service === 'membership') {
      retainedOverheadPence += bill.netPence
      unallocated.push({ billId: bill.id, pence: bill.netPence, reason: 'Fixed membership allocation is excluded from the client comparison and kept as overhead' })
      continue
    }
    if (!bill.accountRef) {
      unallocated.push({ billId: bill.id, pence: bill.netPence, reason: 'Provider account is missing, so the bill stays unallocated overhead' })
      continue
    }
    const covered = events.filter(event => sameAccount(event, bill) && inPeriod(event.occurredAt, bill))
    if (bill.service === 'subscription') {
      const included = covered.filter(event => event.funding === 'included')
      try {
        const split = allocateSubscriptionExpense(bill.netPence, included.map(toAllocation))
        for (const project of split.projects) allocations.push({ billId: bill.id, projectId: project.projectId, pence: project.pence, method: split.method })
        if (split.unassignedPence !== 0) allocations.push({ billId: bill.id, projectId: 'unassigned', pence: split.unassignedPence, method: split.method })
        if (split.unallocatedOverheadPence !== 0) unallocated.push({ billId: bill.id, pence: split.unallocatedOverheadPence, reason: 'Subscription weight left a remainder' })
      } catch (error) {
        unallocated.push({ billId: bill.id, pence: bill.netPence, reason: error instanceof Error ? error.message : 'Subscription usage could not be matched' })
      }
      continue
    }
    const funding = bill.service === 'on-demand' ? 'on-demand' : 'infrastructure'
    const matches = covered.filter(event => event.funding === funding)
    if (!matches.length) {
      unallocated.push({ billId: bill.id, pence: bill.netPence, reason: `No ${funding} usage shares this provider account and billing period` })
      continue
    }
    for (const event of matches) suppressed.add(event.id)
    allocations.push({ billId: bill.id, projectId: matches.every(event => event.projectId === matches[0].projectId) ? matches[0].projectId ?? 'unassigned' : 'mixed', pence: bill.netPence, method: 'provider-bill-covers-usage' })
  }
  return { allocations, unallocated, suppressedEventIds: Array.from(suppressed).sort(), retainedOverheadPence }
}

function toAllocation(event: BillUsage): AllocationEvent {
  return { projectId: event.projectId, funding: event.funding, nominalUnits: event.nominalUnits, providerUnits: event.providerUnits, quality: event.quality, currency: event.currency }
}

export function allocationConserves(bills: ProviderBill[], result: BillMatch) {
  const allocated = result.allocations.reduce((total, row) => total + row.pence, 0)
  const leftover = result.unallocated.reduce((total, row) => total + row.pence, 0)
  return allocated + leftover === bills.reduce((total, bill) => total + bill.netPence, 0)
}
