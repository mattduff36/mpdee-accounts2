import { splitPence } from './profitability'
import { subscriptionWeights } from './subscription-weights'
import { ALLOCATION_METHOD } from './comparison-policy'

export type AllocationEvent = {
  projectId: string | null
  funding: string
  nominalUnits: bigint | null
  providerUnits: bigint | null
  quality: string
  currency: string
}

/** Split one subscription invoice by included nominal value. On-demand cash is not a weight. */
export function allocateSubscriptionExpense(invoicePence: number, events: AllocationEvent[]) {
  if (!Number.isInteger(invoicePence)) throw new Error('Subscription invoice must be integer pence.')
  const shaped = events.map(event => ({
    projectId: event.projectId,
    revisions: [{ funding: event.funding, nominalUnits: event.nominalUnits, quality: event.quality, currency: event.currency }],
  }))
  const { included, weights } = subscriptionWeights(shaped)
  const split = splitPence(invoicePence, Array.from(weights, ([id, weight]) => ({ id, weight })))
  const projects: { projectId: string; pence: number }[] = []
  let unassignedPence = 0
  for (const [id, pence] of Array.from(split)) {
    if (id === 'unassigned') unassignedPence += pence
    else projects.push({ projectId: id, pence })
  }
  projects.sort((a, b) => a.projectId.localeCompare(b.projectId))
  const allocated = projects.reduce((total, row) => total + row.pence, 0) + unassignedPence
  return {
    method: ALLOCATION_METHOD,
    invoicePence,
    projects,
    unassignedPence,
    unallocatedOverheadPence: invoicePence - allocated,
    includedEvents: included.length,
    zeroProviderCashIncluded: events.filter(event => event.funding === 'included' && event.providerUnits === BigInt(0)).length,
  }
}
