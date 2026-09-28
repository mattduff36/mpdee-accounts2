import { createHash } from 'node:crypto'

export type LegacyChargeRow = {
  id: string; projectId: string; sourceRevision: number; sourceChecksum: string
  category: string; periodStart: Date; periodEnd: Date; label: string
  frozenGbpPence: number; invoiceability: string
}
const categories = new Set(['CURSOR', 'VERCEL_HOSTING', 'DATABASE', 'SHARED_VERCEL', 'OTHER'])

/** Complete replacement snapshot of reviewed client charges, never provider cash.
 * Importers must INSERT once using the source-identity uniqueness constraint.
 * Same identity/content is a replay; changed content must fail for explicit review.
 * Updating frozen charges or appending corrections is not implemented here.
 */
export function legacyBaseline(project: string, projectId: string, rows: LegacyChargeRow[]) {
  if (rows.length > 50000) throw new Error('Legacy baseline exceeds 50000 rows')
  const seen = new Set<string>()
  const ordered = rows.slice().sort((a, b) => a.id.localeCompare(b.id))
  const lines = ordered.map(row => {
    if (row.projectId !== projectId || !row.id || seen.has(row.id)) throw new Error('Invalid legacy baseline identity')
    seen.add(row.id)
    if (!Number.isInteger(row.frozenGbpPence) || row.frozenGbpPence < -2147483648 || row.frozenGbpPence > 2147483647) throw new Error('Invalid frozen GBP pence')
    if (!Number.isInteger(row.sourceRevision) || row.sourceRevision < 1 || !row.sourceChecksum) throw new Error('Invalid source revision')
    if (!categories.has(row.category) || !['INVOICEABLE', 'PROVISIONAL'].includes(row.invoiceability)) throw new Error('Invalid legacy classification')
    if (!Number.isFinite(row.periodStart.getTime()) || !Number.isFinite(row.periodEnd.getTime()) || row.periodEnd <= row.periodStart) throw new Error('Invalid exclusive service period')
    return { id: row.id, category: row.category, label: row.label, periodStart: row.periodStart.toISOString(), periodEnd: row.periodEnd.toISOString(), amountMinor: row.frozenGbpPence, currency: 'GBP' as const, invoiceability: row.invoiceability }
  })
  // Provenance affects the revision without exposing private source identifiers.
  const revision = createHash('sha256').update(JSON.stringify({ project, lines, sources: ordered.map(row => [row.id, row.sourceRevision, row.sourceChecksum]) })).digest('hex')
  return { version: 'reviewed-legacy-baseline-v1' as const, project, revision, periodEndExclusive: true as const, currency: 'GBP' as const, accountingTreatment: 'frozen-client-charges-not-provider-cash' as const, lines }
}
