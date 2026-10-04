export type RefreshSourceRow = {
  slug: string
  accountValid: boolean
  evidenceReadable: boolean
  storedLocally: boolean
}

export type RefreshPopulation = {
  sourceRows: number
  copied: number
  alreadyPresent: number
  unreadable: number
  invalidAccount: number
  copiedBySlug: Record<string, number>
}

/** Mutually exclusive refresh outcomes. Replay duplicates are a separate check. */
export function refreshOutcome(row: RefreshSourceRow) {
  if (!row.evidenceReadable) return 'unreadable' as const
  if (!row.accountValid) return 'invalid-account' as const
  if (row.storedLocally) return 'already-present' as const
  return 'copied' as const
}

/** Unassigned work stays unassigned. A copied row keeps its source project. */
export function workspaceRefForSlug(slug: string) {
  if (slug === 'unassigned') return null
  if (!/^[a-z0-9-]+$/.test(slug)) return null
  if (slug === 'itrader') return 'itrader-attributed'
  return `attributed:${slug}`
}

export function summariseRefreshPopulation(rows: RefreshSourceRow[]): RefreshPopulation {
  const counts = { copied: 0, alreadyPresent: 0, unreadable: 0, invalidAccount: 0 }
  const copiedBySlug: Record<string, number> = {}
  for (const row of rows) {
    const outcome = refreshOutcome(row)
    if (outcome === 'copied') {
      counts.copied += 1
      copiedBySlug[row.slug] = (copiedBySlug[row.slug] ?? 0) + 1
    } else if (outcome === 'already-present') counts.alreadyPresent += 1
    else if (outcome === 'unreadable') counts.unreadable += 1
    else counts.invalidAccount += 1
  }
  const total = counts.copied + counts.alreadyPresent + counts.unreadable + counts.invalidAccount
  if (total !== rows.length) throw new Error('Refresh outcomes do not cover the source population')
  return { sourceRows: rows.length, ...counts, copiedBySlug }
}

export function populationText(population: RefreshPopulation, replay: { added: number; duplicate: number }) {
  const copied = Object.entries(population.copiedBySlug).map(([slug, rows]) => `${slug} ${rows}`).join(', ') || 'none'
  return `Cursor source events ${population.sourceRows}. Already in this ledger ${population.alreadyPresent}. Copied this run ${population.copied} (${copied}). Unassigned copies stay unassigned. Unreadable evidence ${population.unreadable}. Invalid account ${population.invalidAccount}. These outcomes sum to ${population.sourceRows}. Replay of the rows sent this run added ${replay.added} and matched ${replay.duplicate} duplicates. The replay overlaps the copied rows and is not another population.`
}
