import { createHash } from 'node:crypto'
import { z } from 'zod'

const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/)
const label = z.string().trim().min(1).max(120).regex(/^[^\x00-\x1f\x7f]+$/)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return value >= '1900-01-01' && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Use a real date on or after 1900-01-01')
const fields = {
  projectId: identifier,
  provider: label,
  name: label,
  currency: z.enum(['GBP', 'USD', 'EUR']),
  amountMinor: z.number().int().min(0).max(2_000_000_000),
  recurrence: z.literal('monthly'),
  effectiveStart: date,
  effectiveEnd: date.nullable(),
  active: z.boolean(),
  notes: z.string().trim().max(2000).regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/).nullable(),
}
function validPeriod(value: { effectiveStart: string; effectiveEnd: string | null }) {
  return value.effectiveEnd === null || value.effectiveEnd > value.effectiveStart
}
export const customRecurringCreateSchema = z.object({
  version: z.literal('mpdee-custom-recurring-v1'),
  sourceKey: identifier,
  ...fields,
}).strict().refine(validPeriod, 'End date must be after start (end exclusive)')
export const customRecurringEditSchema = z.object({
  version: z.literal('mpdee-custom-recurring-v1'),
  id: identifier,
  expectedRevision: z.number().int().min(1).max(1_999_999_999),
  ...fields,
}).strict().refine(validPeriod, 'End date must be after start (end exclusive)')
export const customRecurringQuerySchema = z.object({
  projectId: identifier.optional(),
  after: identifier.optional(),
  limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).pipe(z.number().max(100)).default('50'),
}).strict()

export type CustomRecurringCreate = z.infer<typeof customRecurringCreateSchema>
export type CustomRecurringEdit = z.infer<typeof customRecurringEditSchema>
export type CustomRecurringFields = Pick<CustomRecurringCreate, keyof typeof fields>
export type CustomRecurringQuery = z.infer<typeof customRecurringQuerySchema>
export type CustomRecurringActor = { actorType: 'machine'; actorId: null } | { actorType: 'user'; actorId: string }
export type CustomRecurringIdentity = { id: string; importChecksum: string; revision: number }
export class CustomRecurringError extends Error {
  constructor(public readonly status: 400 | 404 | 409, message: string) { super(message) }
}
export function normalizeCustomRecurring(raw: unknown) {
  const record = customRecurringCreateSchema.parse(raw)
  return { record, checksum: createHash('sha256').update(JSON.stringify(record)).digest('hex') }
}
export function recurringFields(record: CustomRecurringFields): CustomRecurringFields {
  return {
    projectId: record.projectId, provider: record.provider, name: record.name,
    currency: record.currency, amountMinor: record.amountMinor, recurrence: record.recurrence,
    effectiveStart: record.effectiveStart, effectiveEnd: record.effectiveEnd, active: record.active, notes: record.notes,
  }
}
export type CustomRecurringStore = {
  findSource: (sourceKey: string) => Promise<CustomRecurringIdentity | null>
  findId: (id: string) => Promise<CustomRecurringIdentity | null>
  create: (record: CustomRecurringCreate, checksum: string) => Promise<CustomRecurringIdentity>
  update: (record: CustomRecurringEdit) => Promise<CustomRecurringIdentity>
}
// The persistence adapter serializes source replays and makes edits/audit writes atomic.
export async function createCustomRecurring(raw: unknown, store: CustomRecurringStore) {
  const { record, checksum } = normalizeCustomRecurring(raw)
  const existing = await store.findSource(record.sourceKey)
  if (existing) {
    if (existing.importChecksum !== checksum) throw new CustomRecurringError(409, 'Source key already has different original content; edit in Accounts')
    return { version: 'mpdee-custom-recurring-ack-v1', status: 'duplicate', id: existing.id, revision: existing.revision }
  }
  const created = await store.create(record, checksum)
  return { version: 'mpdee-custom-recurring-ack-v1', status: 'added', id: created.id, revision: created.revision }
}
export async function editCustomRecurring(raw: unknown, store: CustomRecurringStore) {
  const record = customRecurringEditSchema.parse(raw)
  const existing = await store.findId(record.id)
  if (!existing) throw new CustomRecurringError(404, 'Recurring cost not found')
  if (existing.revision !== record.expectedRevision) throw new CustomRecurringError(409, 'Recurring cost changed; reload before editing')
  const updated = await store.update(record)
  return { version: 'mpdee-custom-recurring-ack-v1', status: 'updated', id: updated.id, revision: updated.revision }
}
