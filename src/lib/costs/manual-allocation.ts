import { z } from 'zod'

export const MANUAL_ALLOCATION_VERSION = 'mpdee-manual-allocation-v1'
const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/)
export const manualSourceKind = z.enum(['subscription_invoice', 'custom_recurring'])
export type ManualSourceKind = z.infer<typeof manualSourceKind>
export const allocationSharesSchema = z.array(z.object({
  projectId: identifier,
  shareBps: z.number().int().min(1).max(10000),
}).strict()).max(100).superRefine((shares, context) => {
  if (new Set(shares.map(share => share.projectId)).size !== shares.length) {
    context.addIssue({ code: 'custom', message: 'Choose each project only once' })
  }
  if (shares.reduce((total, share) => total + share.shareBps, 0) > 10000) {
    context.addIssue({ code: 'custom', message: 'Project percentages must total at most 100%' })
  }
})
export type AllocationShare = z.infer<typeof allocationSharesSchema>[number]
export const manualAllocationSchema = z.object({
  version: z.literal(MANUAL_ALLOCATION_VERSION),
  sourceKind: manualSourceKind,
  sourceId: identifier,
  expectedRevision: z.number().int().min(0).max(1_999_999_999),
  shares: allocationSharesSchema,
}).strict()
export type ManualAllocationInput = z.infer<typeof manualAllocationSchema>
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`)
  return value >= '1900-01-01' && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Use a real date on or after 1900-01-01')
export const manualAllocationQuerySchema = z.object({
  sourceKind: manualSourceKind,
  sourceId: identifier.optional(),
  after: identifier.optional(),
  asOf: date.default(() => new Date().toISOString().slice(0, 10)),
  limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).pipe(z.number().max(100)).default('50'),
}).strict().refine(query => !query.sourceId || !query.after, 'Use an exact source ID or a cursor, not both')
export type ManualAllocationQuery = z.infer<typeof manualAllocationQuerySchema>
export class ManualAllocationError extends Error {
  constructor(public readonly status: 400 | 404 | 409, message: string) { super(message) }
}

export function percentageBps(text: string): number | null {
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return bps <= 10000 ? bps : null
}

/** Largest remainder; project ID (then unallocated) breaks ties, independent of row order. */
export function allocateMinor(amount: number, rawShares: AllocationShare[]) {
  if (!Number.isSafeInteger(amount)) throw new Error('Allocation amount must be a safe integer')
  const shares = allocationSharesSchema.parse(rawShares)
    .sort((a, b) => a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0)
  const buckets: { projectId: string | null; shareBps: number }[] = [
    ...shares.map(share => ({ projectId: share.projectId, shareBps: share.shareBps })),
    { projectId: null, shareBps: 10000 - shares.reduce((sum, share) => sum + share.shareBps, 0) },
  ]
  const absolute = BigInt(amount < 0 ? -amount : amount)
  const parts = buckets.map((bucket, index) => {
    const product = absolute * BigInt(bucket.shareBps)
    return { ...bucket, index, minor: product / BigInt(10000), remainder: product % BigInt(10000) }
  })
  const remaining = Number(absolute - parts.reduce((sum, part) => sum + part.minor, BigInt(0)))
  const ranked = [...parts].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)
  for (const part of ranked.slice(0, remaining)) part.minor += BigInt(1)
  return parts.map(part => ({
    projectId: part.projectId, shareBps: part.shareBps,
    amountMinor: part.minor === BigInt(0) ? 0 : Number(part.minor) * (amount < 0 ? -1 : 1),
  }))
}

export type ManualAllocationState = {
  revision: number
  basis: 'user_selected' | 'legacy_single_project_default' | 'unallocated'
  shares: AllocationShare[]
  unallocatedBps: number
}
export function manualAllocationState(
  stored: { revision: number; shares: AllocationShare[] } | null,
  defaultProjectId?: string,
): ManualAllocationState {
  const shares = allocationSharesSchema.parse(stored?.shares ?? (defaultProjectId ? [{ projectId: defaultProjectId, shareBps: 10000 }] : []))
  return {
    revision: stored?.revision ?? 0,
    basis: stored ? 'user_selected' : defaultProjectId ? 'legacy_single_project_default' : 'unallocated',
    shares, unallocatedBps: 10000 - shares.reduce((sum, share) => sum + share.shareBps, 0),
  }
}
export type ManualAllocationStore = {
  sourceExists: (kind: ManualSourceKind, id: string) => Promise<boolean>
  currentRevision: (kind: ManualSourceKind, id: string) => Promise<number>
  projectsExist: (ids: string[]) => Promise<boolean>
  commit: (input: ManualAllocationInput, actorId: string) => Promise<ManualAllocationState>
}
export async function saveManualAllocation(raw: unknown, actorId: string, store: ManualAllocationStore) {
  const input = manualAllocationSchema.parse(raw)
  if (!await store.sourceExists(input.sourceKind, input.sourceId)) throw new ManualAllocationError(404, 'Cost source not found')
  if (await store.currentRevision(input.sourceKind, input.sourceId) !== input.expectedRevision) {
    throw new ManualAllocationError(409, 'Allocation changed; reload before editing')
  }
  if (!await store.projectsExist(input.shares.map(share => share.projectId))) {
    throw new ManualAllocationError(400, 'Choose existing Accounts cost projects')
  }
  return store.commit(input, actorId)
}

export function allocatedSourceAmounts(amountMinor: number, gbpEstimatePence: number | null, state: ManualAllocationState) {
  const native = allocateMinor(amountMinor, state.shares)
  const gbp = gbpEstimatePence === null ? null : allocateMinor(gbpEstimatePence, state.shares)
  return native.map((bucket, index) => ({
    ...bucket, gbpEstimatePence: gbp?.[index].amountMinor ?? null,
  }))
}
