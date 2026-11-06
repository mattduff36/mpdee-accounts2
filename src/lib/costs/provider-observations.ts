import { createHash } from 'node:crypto'
import { z } from 'zod'

const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return value >= '1900-01-01' && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Use a real date on or after 1900-01-01')
const timestamp = z.string().datetime({ offset: true }).refine(value =>
  date.safeParse(value.slice(0, 10)).success && Number.isFinite(Date.parse(value)),
'Use a real ISO timestamp')
const boundary = z.union([date, timestamp])
const period = z.object({ from: boundary, to: boundary }).strict()
  .refine(value => Date.parse(value.to) > Date.parse(value.from), 'End must be after start (end exclusive)')
const amount = z.string().max(30).regex(/^(0|[1-9]\d{0,9})(\.\d{1,18})?$/)
  .pipe(z.string().refine(value => {
    const [whole, fraction = ''] = value.split('.')
    return BigInt(whole) < 1_000_000_000n || (BigInt(whole) === 1_000_000_000n && !/[1-9]/.test(fraction))
  }, 'Value must not exceed 1000000000'))

export const providerObservationSchema = z.object({
  version: z.literal('mpdee-provider-observation-v1'),
  provider: z.literal('vercel'),
  accountRef: identifier,
  sourceKey: identifier,
  sourceHash: z.string().regex(/^[a-fA-F0-9]{64}$/).transform(value => value.toLowerCase()),
  observedAt: timestamp,
  coverage: z.enum(['partial', 'complete']),
  status: z.enum(['requires_reconciliation', 'provider_reported']),
  periods: z.array(period).min(1).max(31),
  gaps: z.array(period).max(31),
  groups: z.array(z.object({
    projectId: identifier.nullable().optional().default(null),
    resourceId: identifier.nullable().optional().default(null),
    currency: z.enum(['GBP', 'USD', 'EUR']),
    usageValue: amount,
    subscriptionValue: amount,
  }).strict()).max(200),
  notes: z.string().max(500).regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/).optional().default(''),
}).strict()
export const providerObservationQuerySchema = z.object({
  provider: z.literal('vercel').optional(),
  accountRef: identifier.optional(),
  sourceKey: identifier.optional(),
  limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).pipe(z.number().max(100)).default('50'),
}).strict()
export type ProviderObservation = z.infer<typeof providerObservationSchema>
export type ProviderObservationQuery = z.infer<typeof providerObservationQuerySchema>
export type ObservationRow = {
  id: string; provider: string; accountRef: string; sourceKey: string; checksum: string
  payload: unknown; observedAt: Date; createdAt: Date
}
export class ProviderObservationError extends Error {
  constructor(public readonly status: 400, message: string) { super(message) }
}
export function normalizeProviderObservation(raw: unknown) {
  const record = providerObservationSchema.parse(raw)
  return { record, checksum: createHash('sha256').update(JSON.stringify(record)).digest('hex') }
}
export type ProviderObservationStore = {
  findExact: (record: ProviderObservation, checksum: string) => Promise<{ id: string } | null>
  create: (record: ProviderObservation, checksum: string) => Promise<{ id: string }>
}
export async function createProviderObservation(raw: unknown, store: ProviderObservationStore) {
  const { record, checksum } = normalizeProviderObservation(raw)
  const existing = await store.findExact(record, checksum)
  const row = existing ?? await store.create(record, checksum)
  return {
    version: 'mpdee-provider-observation-ack-v1',
    status: existing ? 'duplicate' : 'added', id: row.id, checksum,
  }
}
export function compareObservationRecency(a: ObservationRow, b: ObservationRow) {
  return a.observedAt.getTime() - b.observedAt.getTime()
    || a.createdAt.getTime() - b.createdAt.getTime()
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
export function latestProviderObservations(rows: ObservationRow[]) {
  const latest = new Map<string, ObservationRow>()
  for (const row of rows) {
    const key = JSON.stringify([row.provider, row.accountRef, row.sourceKey])
    const previous = latest.get(key)
    if (!previous || compareObservationRecency(row, previous) > 0) latest.set(key, row)
  }
  return [...latest.values()]
}
export function providerObservationReport(rows: ObservationRow[], limit: number) {
  const latest = latestProviderObservations(rows)
  const records = latest.slice(0, limit).map(row => {
    const payload = providerObservationSchema.parse(row.payload)
    return {
      id: row.id, checksum: row.checksum, createdAt: row.createdAt.toISOString(), ...payload,
      warnings: [
        ...(payload.coverage === 'partial' ? ['partial_coverage'] : []),
        ...(payload.gaps.length ? ['declared_gaps'] : []),
        ...(payload.status === 'requires_reconciliation' ? ['requires_reconciliation'] : []),
      ],
    }
  })
  const truncated = latest.length > limit
  return {
    version: 'mpdee-provider-observation-list-v1', records, truncated, limit,
    selection: 'latest_per_provider_account_sourceKey',
    warnings: [
      'provisional_provider_values_not_cash_paid_or_expenses',
      'snapshots_may_overlap_do_not_add',
      'usage_and_subscription_values_are_separate',
      ...(truncated ? ['result_truncated_refine_accountRef_or_sourceKey'] : []),
    ],
  }
}
