/** Marker appended to a copied usage event when one provider row is shared across projects. */
export const MANUAL_SPLIT_MARKER = '#manual-split:'

/** Equal integer shares. Earlier project ids absorb the remainder. Null stays null on every share. */
export function splitBigint(amount: bigint | null, projectIds: readonly string[]): Map<string, bigint | null> {
  const ids = [...projectIds].sort((a, b) => a.localeCompare(b))
  if (new Set(ids).size !== ids.length) throw new Error('Split projects must be unique')
  const shares = new Map<string, bigint | null>()
  if (!ids.length) return shares
  if (amount === null) {
    for (const id of ids) shares.set(id, null)
    return shares
  }
  const parts = BigInt(ids.length)
  const negative = amount < BigInt(0)
  const absolute = negative ? -amount : amount
  const base = absolute / parts
  let remainder = absolute % parts
  for (const id of ids) {
    const extra = remainder > BigInt(0) ? BigInt(1) : BigInt(0)
    if (remainder > BigInt(0)) remainder -= BigInt(1)
    const share = base + extra
    shares.set(id, negative ? -share : share)
  }
  return shares
}

export function parentSourceKey(sourceKey: string): string | null {
  const marker = sourceKey.indexOf(MANUAL_SPLIT_MARKER)
  if (marker < 0) return null
  return sourceKey.slice(0, marker)
}
