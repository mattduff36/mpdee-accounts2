export function isFreeCredit(funding: string) {
  return funding === 'free-credit'
}

/** Funding label only. Quality, membership and invoice coverage are separate gates. */
export function isConfirmedProviderCash(provider: string, funding: string) {
  if (isFreeCredit(funding) || funding === 'included' || funding === 'unknown') return false
  return (provider === 'cursor' && funding === 'on-demand') || funding === 'infrastructure'
}

export function isSyntheticMembershipSource(sourceKey: string) {
  return sourceKey.startsWith('vercel:membership:')
}

/** Synthetic membership and rows explicitly covered by a provider invoice are evidence, not cash or a client charge. */
export function excludedFromClientAndConfirmedCash(group: { sourceKey: string; coveredByProviderInvoice: boolean }) {
  return group.coveredByProviderInvoice || isSyntheticMembershipSource(group.sourceKey)
}

/** Partial, review and unknown quality are not confirmed provider cash. */
export function showsConfirmedProviderCash(group: { provider: string; funding: string; quality: string; sourceKey: string; coveredByProviderInvoice: boolean }) {
  if (group.quality !== 'complete') return false
  if (excludedFromClientAndConfirmedCash(group)) return false
  return isConfirmedProviderCash(group.provider, group.funding)
}

/** Unassigned infrastructure cash stays on the unassigned figure. Membership and invoice-covered evidence do not. */
export function countsAsUnassignedProviderCash(group: { assigned: boolean; funding: string; sourceKey: string; coveredByProviderInvoice: boolean }) {
  return !group.assigned && group.funding === 'infrastructure' && !excludedFromClientAndConfirmedCash(group)
}
