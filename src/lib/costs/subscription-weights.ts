type UsageRevision = {
  funding: string
  nominalUnits: bigint | null
  quality: string
  currency: string
}
type SubscriptionEvent = { projectId: string | null; revisions: UsageRevision[] }

/** Validate the entire account window before selecting subscription weights. */
export function subscriptionWeights<T extends SubscriptionEvent>(events: T[]) {
  if (!events.length || events.length > 50000) throw new Error('A usable usage window (1–50,000 events) is required.')
  if (events.some(event => !event.revisions[0])) throw new Error('Some usage records have no monetary revision. Resolve them before allocating this bill.')
  if (events.some(event => !['included', 'on-demand'].includes(event.revisions[0].funding))) {
    throw new Error('Some usage records have unresolved funding. Review their funding before allocating this bill; they cannot be silently excluded from subscription weights.')
  }
  const included = events.filter(event => event.revisions[0].funding === 'included')
  if (!included.length) throw new Error('No included usage exists for this account and period.')
  if (included.some(event => event.revisions[0].nominalUnits === null || event.revisions[0].nominalUnits! < BigInt(0) || event.revisions[0].quality !== 'complete')) {
    throw new Error('Some included records need monetary review. Resolve them before allocating this bill.')
  }
  if (new Set(included.map(event => event.revisions[0].currency)).size !== 1) throw new Error('Mixed source currencies cannot be used as comparable usage weights.')
  // Recognized on-demand monetary reviews do not alter subscription weights.
  // Unassigned usage stays in the denominator rather than inflating project shares.
  const weights = new Map<string, bigint>()
  for (const event of included) {
    const id = event.projectId || 'unassigned'
    weights.set(id, (weights.get(id) || BigInt(0)) + event.revisions[0].nominalUnits!)
  }
  return { included, weights }
}
