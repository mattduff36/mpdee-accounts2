import { createHash } from 'node:crypto'
import { chargeUnits, decimalUnits, roundRatio, UNIT, type Policy } from './money'
import type { FxQuote } from './fx-values'

type SnapshotRow = {
  event: { id: string; provider: string; occurredAt: Date }
  revision?: { id: string; revision: number; checksum: string; createdAt: Date; funding: string; nominalUnits: bigint | null; providerUnits: bigint | null; currency: string; quality: string }
  policy: (Policy & { id: string; effectiveAt: Date }) | null
  hold: string | null
  fx: FxQuote | null
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v)).digest('hex')
const categoryFor = (provider: string) => provider === 'cursor' ? 'CURSOR' : provider === 'vercel' ? 'VERCEL_HOSTING' : provider === 'supabase' ? 'DATABASE' : 'OTHER'
const labels = { CURSOR: 'Cursor usage', VERCEL_HOSTING: 'Vercel hosting', DATABASE: 'Database', OTHER: 'Other costs' }

export function projectSnapshot(project: string, rows: SnapshotRow[], asOf: Date, imports: Date[] = [], from: string | null = null) {
  if (rows.length > 50000) throw new Error('Project snapshot exceeds 50000 events')
  const groups = new Map<string, { date: string; category: ReturnType<typeof categoryFor>; funding: string; currency: string; held: boolean; rows: SnapshotRow[] }>()
  let heldCount = 0, fxMissing = 0
  for (const row of rows) {
    const revision = row.revision
    const held = !!row.hold || !revision || !row.policy || revision.quality !== 'complete' || chargeUnits({ provider: row.event.provider, funding: revision.funding, nominal: revision.nominalUnits, cash: revision.providerUnits }, row.policy) === null
    if (held) heldCount++
    if (!row.fx) fxMissing++
    const date = row.event.occurredAt.toISOString().slice(0, 10), category = categoryFor(row.event.provider), funding = revision?.funding ?? 'unknown', currency = revision?.currency ?? 'unknown'
    const key = JSON.stringify([project, from, date, category, funding, currency, held])
    const group = groups.get(key) ?? { date, category, funding, currency, held, rows: [] }
    group.rows.push(row); groups.set(key, group)
  }
  const lines = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => {
    const ordered = [...group.rows].sort((a, b) => a.event.id.localeCompare(b.event.id))
    const proofs = ordered.map(row => ({ eventId: row.event.id, provider: row.event.provider, revision: row.revision, policy: row.policy, hold: !!row.hold, fx: row.fx }))
    let sourceUnits = BigInt(0), gbpNumerator = BigInt(0)
    let missingFx = false
    for (const row of ordered) {
      if (group.held) continue
      // Preserve the ledger's 1e-7 source-unit rounding; round GBP pence only once per group.
      const charge = chargeUnits({ provider: row.event.provider, funding: group.funding, nominal: row.revision!.nominalUnits, cash: row.revision!.providerUnits }, row.policy!)!
      sourceUnits += charge
      if (!row.fx) { missingFx = true; continue }
      gbpNumerator += charge * decimalUnits(row.fx.rate, 8)
    }
    const pence = group.held || missingFx ? null : roundRatio(gbpNumerator * BigInt(100), UNIT * BigInt(100000000))
    if (pence !== null && (pence > BigInt(Number.MAX_SAFE_INTEGER) || pence < BigInt(Number.MIN_SAFE_INTEGER))) throw new Error('Snapshot amount exceeds safe integer range')
    const fx = Array.from(new Map(ordered.filter(r => r.fx).map(r => [hash(r.fx), r.fx!])).values()).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    return { id: hash(key), revision: hash(proofs), category: group.category, label: labels[group.category], periodStart: group.date, periodEnd: group.date, amountMinor: pence === null ? null : Number(pence), currency: 'GBP' as const, provisional: true as const, held: group.held, funding: group.funding, events: ordered.length, sourceCurrency: group.currency, sourceUnits: group.held ? null : sourceUnits.toString(), fx }
  })
  const dates = [...imports, ...rows.flatMap(r => r.revision ? [r.revision.createdAt] : [])].map(d => d.toISOString()).sort()
  const sourceUpdatedAt = dates.at(-1) ?? null
  const coverage = { events: rows.length, held: heldCount, fxMissing, from }
  return { version: 'mpdee-project-cost-snapshot-v2' as const, project, approvedSnapshot: false as const, asOf: asOf.toISOString(), revision: hash({ project, lines, coverage }), sourceUpdatedAt, coverage, lines }
}

