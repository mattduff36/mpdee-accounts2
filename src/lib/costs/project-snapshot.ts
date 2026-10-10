import { createHash } from 'node:crypto'
import type { CalculationRates, HostingSchedule } from './calculation-settings'
import { DAILY_HOSTING_LABEL, type DailyHostingFee } from './daily-hosting'
import { CHARGE_RULE_VERSION, chargeUnits, decimalUnits, roundRatio, UNIT, type Policy } from './money'
import type { FxQuote } from './fx-values'

type SnapshotRow = {
  event: { id: string; provider: string; occurredAt: Date; model?: string | null }
  revision?: { id: string; revision: number; checksum: string; createdAt: Date; funding: string; nominalUnits: bigint | null; providerUnits: bigint | null; currency: string; quality: string }
  policy: (Policy & { id: string; effectiveAt: Date }) | null
  hold: string | null
  fx: FxQuote | null
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v)).digest('hex')
const categoryFor = (provider: string) => provider === 'cursor' ? 'CURSOR' : provider === 'vercel' ? 'VERCEL_HOSTING' : provider === 'supabase' ? 'DATABASE' : 'OTHER'
const labels = { CURSOR: 'Cursor usage', VERCEL_HOSTING: 'Vercel hosting', DATABASE: 'Database', OTHER: 'Other costs' }
const SNAPSHOT_LIMIT = 50000

export type ProjectSnapshotOptions = {
  rates?: CalculationRates
  hostingFees?: readonly DailyHostingFee[]
  globalRevision?: string
  projectRevision?: string
  hostingSchedule?: HostingSchedule
}

function hostingFeeLines(project: string, from: string | null, fees: readonly DailyHostingFee[], rates: CalculationRates | undefined) {
  const seen = new Set<string>()
  const lines = []
  for (const fee of [...fees].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    if (fee.providerCash !== false) throw new Error('Hosting fee cannot be provider cash')
    if (fee.category !== 'VERCEL_HOSTING' || fee.funding !== 'infrastructure' || fee.currency !== 'GBP' || fee.label !== DAILY_HOSTING_LABEL) throw new Error('Invalid hosting fee')
    if (!Number.isSafeInteger(fee.amountPence) || fee.amountPence < 0) throw new Error('Invalid hosting fee')
    if (fee.amountPence === 0) continue
    if (seen.has(fee.date)) throw new Error('Duplicate hosting fee date')
    seen.add(fee.date)
    const sourceUnits = BigInt(fee.amountPence) * UNIT / BigInt(100)
    const proof = { kind: 'daily-hosting', id: fee.id, chargeRule: CHARGE_RULE_VERSION, rates: rates ?? null, configRevision: fee.configRevision, amountPence: fee.amountPence, providerCash: false, label: fee.label }
    lines.push({
      id: hash(['daily-hosting', project, from, fee.date]),
      revision: hash(proof),
      category: 'VERCEL_HOSTING' as const,
      label: DAILY_HOSTING_LABEL,
      periodStart: fee.date,
      periodEnd: fee.date,
      amountMinor: fee.amountPence,
      currency: 'GBP' as const,
      provisional: true as const,
      held: false,
      funding: 'infrastructure',
      events: 0,
      sourceCurrency: 'GBP',
      sourceUnits: sourceUnits.toString(),
      fx: [{ currency: 'GBP', date: fee.date, rate: '1', source: 'GBP original amount' }],
    })
  }
  return lines
}

export function projectSnapshot(project: string, rows: SnapshotRow[], asOf: Date, imports: Date[] = [], from: string | null = null, options?: ProjectSnapshotOptions) {
  const fees = options?.hostingFees ?? []
  if (rows.length > SNAPSHOT_LIMIT || rows.length + fees.length > SNAPSHOT_LIMIT) throw new Error('Project snapshot exceeds 50000 events')
  const groups = new Map<string, { date: string; category: ReturnType<typeof categoryFor>; funding: string; currency: string; held: boolean; rows: SnapshotRow[] }>()
  let heldCount = 0, fxMissing = 0
  for (const row of rows) {
    const revision = row.revision
    const held = !!row.hold || !revision || !row.policy || revision.quality !== 'complete' || chargeUnits({ provider: row.event.provider, funding: revision.funding, nominal: revision.nominalUnits, cash: revision.providerUnits, model: row.event.model ?? null }, row.policy) === null
    if (held) heldCount++
    if (!row.fx) fxMissing++
    const date = row.event.occurredAt.toISOString().slice(0, 10), category = categoryFor(row.event.provider), funding = revision?.funding ?? 'unknown', currency = revision?.currency ?? 'unknown'
    const key = JSON.stringify([project, from, date, category, funding, currency, held])
    const group = groups.get(key) ?? { date, category, funding, currency, held, rows: [] }
    group.rows.push(row); groups.set(key, group)
  }
  const sourceLines = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => {
    const ordered = [...group.rows].sort((a, b) => a.event.id.localeCompare(b.event.id))
    const proofs = { chargeRule: CHARGE_RULE_VERSION, rows: ordered.map(row => ({ eventId: row.event.id, provider: row.event.provider, model: row.event.model ?? null, revision: row.revision, policy: row.policy, hold: !!row.hold, fx: row.fx })) }
    let sourceUnits = BigInt(0), gbpNumerator = BigInt(0)
    let missingFx = false
    for (const row of ordered) {
      if (group.held) continue
      // Preserve the ledger's 1e-7 source-unit rounding; round GBP pence only once per group.
      const charge = chargeUnits({ provider: row.event.provider, funding: group.funding, nominal: row.revision!.nominalUnits, cash: row.revision!.providerUnits, model: row.event.model ?? null }, row.policy!)!
      sourceUnits += charge
      if (!row.fx) { missingFx = true; continue }
      gbpNumerator += charge * decimalUnits(row.fx.rate, 8)
    }
    const pence = group.held || missingFx ? null : roundRatio(gbpNumerator * BigInt(100), UNIT * BigInt(100000000))
    if (pence !== null && (pence > BigInt(Number.MAX_SAFE_INTEGER) || pence < BigInt(Number.MIN_SAFE_INTEGER))) throw new Error('Snapshot amount exceeds safe integer range')
    const fx = Array.from(new Map(ordered.filter(r => r.fx).map(r => [hash(r.fx), r.fx!])).values()).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    return { id: hash(key), revision: hash(proofs), category: group.category, label: labels[group.category], periodStart: group.date, periodEnd: group.date, amountMinor: pence === null ? null : Number(pence), currency: 'GBP' as const, provisional: true as const, held: group.held, funding: group.funding, events: ordered.length, sourceCurrency: group.currency, sourceUnits: group.held ? null : sourceUnits.toString(), fx }
  })
  const feeLines = hostingFeeLines(project, from, fees, options?.rates)
  const lines = feeLines.length ? [...sourceLines, ...feeLines] : sourceLines
  const dates = [...imports, ...rows.flatMap(r => r.revision ? [r.revision.createdAt] : [])].map(d => d.toISOString()).sort()
  const sourceUpdatedAt = dates.at(-1) ?? null
  const coverage = { events: rows.length, held: heldCount, fxMissing, from }
  const proof = { project, chargeRule: CHARGE_RULE_VERSION, lines, coverage }
  const calculation = options && (options.rates || options.hostingFees || options.globalRevision || options.projectRevision || options.hostingSchedule)
    ? {
        rates: options.rates ?? null,
        globalRevision: options.globalRevision ?? null,
        projectRevision: options.projectRevision ?? null,
        hostingSchedule: options.hostingSchedule ?? null,
        hostingConfigRevisions: Array.from(new Set(fees.map(fee => fee.configRevision))).sort(),
      }
    : null
  return { version: 'mpdee-project-cost-snapshot-v2' as const, project, approvedSnapshot: false as const, asOf: asOf.toISOString(), revision: hash(calculation ? { ...proof, calculation } : proof), sourceUpdatedAt, coverage, lines }
}

