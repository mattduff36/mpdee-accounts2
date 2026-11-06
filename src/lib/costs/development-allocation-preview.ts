import { z } from 'zod'

export const DEVELOPMENT_ALLOCATION_PREVIEW_VERSION = 'mpdee-development-allocation-preview-v1'

const reference = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'Invalid calendar day')
const weight = z.string().max(30).regex(/^(0|[1-9]\d*)$/)
const scope = z.object({
  provider: z.enum(['openai', 'codex']),
  accountRef: reference,
  currency: z.enum(['USD', 'GBP', 'EUR']),
  periodStart: day,
  periodEnd: day,
}).strict().refine(value => value.periodEnd > value.periodStart, 'Service period must be nonempty; end is exclusive')
const invoiceSchema = z.object({
  scope,
  grossMinor: z.number().int().nonnegative().max(2_000_000_000),
}).strict()
const measurement = z.object({
  scope,
  // Only comparable monetary usage values are supported, never raw tokens or allowances.
  basis: z.literal('provider-reported-value'),
  decimalPlaces: z.number().int().min(0).max(9),
  weight,
  evidenceRef: reference,
}).strict()
const bucket = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project'), projectId: reference }).strict(),
  z.object({ kind: z.literal('personal') }).strict(),
  z.object({ kind: z.literal('unassigned') }).strict(),
])
const evidenceSchema = z.object({
  version: z.literal('mpdee-development-allocation-evidence-v1'),
  review: z.discriminatedUnion('status', [
    z.object({ status: z.literal('provisional') }).strict(),
    z.object({ status: z.literal('reviewed'), reference }).strict(),
  ]),
  coverage: z.discriminatedUnion('status', [
    z.object({ status: z.literal('partial') }).strict(),
    z.object({ status: z.literal('unknown') }).strict(),
    z.object({ status: z.literal('complete-verified'), reference }).strict(),
  ]),
  // This is an independently measured whole-account total, not a project subtotal.
  accountDenominator: measurement.optional(),
  weights: z.array(z.object({ bucket, measurement }).strict()).max(1000),
}).strict()

export type DevelopmentAllocationInvoice = z.infer<typeof invoiceSchema>
export type DevelopmentAllocationEvidence = z.infer<typeof evidenceSchema>
type Preview = {
  version: typeof DEVELOPMENT_ALLOCATION_PREVIEW_VERSION
  status: 'inactive' | 'provisional' | 'reviewed'
  label: 'Inactive / unallocated' | 'Provisional preview' | 'Reviewed preview'
  reason: string
  currency: DevelopmentAllocationInvoice['scope']['currency']
  invoiceMinor: number
  projects: { projectId: string; minor: number }[]
  personalMinor: number
  unassignedMinor: number
  unallocatedMinor: number
  denominatorWeight: string | null
  unmeasuredWeight: string | null
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const bucketKey = (value: z.infer<typeof bucket>) => value.kind === 'project' ? `project:${value.projectId}` : value.kind
const sameScope = (a: DevelopmentAllocationInvoice['scope'], b: DevelopmentAllocationInvoice['scope']) =>
  a.provider === b.provider && a.accountRef === b.accountRef && a.currency === b.currency &&
  a.periodStart === b.periodStart && a.periodEnd === b.periodEnd

/** Pure hypothetical split. No imports, persistence, FX, legacy allocation or financial writes. */
export function previewDevelopmentAllocation(invoiceInput: unknown, evidenceInput?: unknown): Preview {
  const invoice = invoiceSchema.parse(invoiceInput)
  const result: Preview = {
    version: DEVELOPMENT_ALLOCATION_PREVIEW_VERSION,
    status: 'inactive',
    label: 'Inactive / unallocated',
    reason: 'No reviewed allocation evidence selected. The entire invoice remains unallocated.',
    currency: invoice.scope.currency,
    invoiceMinor: invoice.grossMinor,
    projects: [],
    personalMinor: 0,
    unassignedMinor: 0,
    unallocatedMinor: invoice.grossMinor,
    denominatorWeight: null,
    unmeasuredWeight: null,
  }
  if (evidenceInput === undefined) return result
  const evidence = evidenceSchema.parse(evidenceInput)
  const measurements = evidence.weights.map(row => row.measurement)
  if (evidence.accountDenominator) measurements.push(evidence.accountDenominator)
  if (measurements.some(row => !sameScope(row.scope, invoice.scope))) {
    throw new Error('Every measurement must match the invoice provider, account, currency and full service period.')
  }
  if (new Set(measurements.map(row => row.decimalPlaces)).size > 1) {
    throw new Error('Measurements must use one comparable value scale.')
  }
  const keys = evidence.weights.map(row => bucketKey(row.bucket))
  if (new Set(keys).size !== keys.length) throw new Error('Use one non-overlapping measured total per bucket.')
  const refs = evidence.weights.map(row => row.measurement.evidenceRef)
  if (new Set(refs).size !== refs.length) throw new Error('The same measured evidence cannot be counted in multiple buckets.')
  if (evidence.accountDenominator && refs.includes(evidence.accountDenominator.evidenceRef)) {
    throw new Error('The account denominator must be independently measured, not reused bucket evidence.')
  }
  const known = evidence.weights.reduce((sum, row) => sum + BigInt(row.measurement.weight), 0n)
  if (!evidence.accountDenominator && evidence.coverage.status !== 'complete-verified') {
    return { ...result, reason: 'No independent account denominator or complete verified coverage. Project subsets cannot be renormalized; the entire invoice remains unallocated.' }
  }
  const denominator = evidence.accountDenominator ? BigInt(evidence.accountDenominator.weight) : known
  if (known > denominator) throw new Error('Measured buckets exceed the account denominator.')
  if (evidence.coverage.status === 'complete-verified' && known !== denominator) {
    throw new Error('Complete verified coverage must reconcile exactly to the account denominator.')
  }
  if (denominator === 0n || known === 0n) {
    return { ...result, denominatorWeight: denominator.toString(), unmeasuredWeight: denominator.toString(), reason: 'No positive measured bucket weight. The entire invoice remains unallocated.' }
  }
  const residual = denominator - known
  const rows = [
    ...evidence.weights.map(row => ({ key: bucketKey(row.bucket), weight: BigInt(row.measurement.weight) })),
    { key: 'residual', weight: residual },
  ].map(row => {
    const numerator = BigInt(invoice.grossMinor) * row.weight
    return { ...row, minor: Number(numerator / denominator), remainder: numerator % denominator }
  })
  const remaining = invoice.grossMinor - rows.reduce((sum, row) => sum + row.minor, 0)
  const ranked = [...rows].sort((a, b) => a.remainder === b.remainder ? compare(a.key, b.key) : a.remainder > b.remainder ? -1 : 1)
  for (let i = 0; i < remaining; i++) ranked[i].minor++
  const amounts = new Map(rows.map(row => [row.key, row.minor]))
  return {
    ...result,
    status: evidence.review.status,
    label: evidence.review.status === 'reviewed' ? 'Reviewed preview' : 'Provisional preview',
    reason: residual > 0n ? 'Incomplete measured coverage: the unmeasured account share remains unallocated. Preview only; no financial records changed.' : 'Measured coverage reconciles. Preview only; no financial records changed.',
    projects: evidence.weights.flatMap(row => row.bucket.kind === 'project' ? [{ projectId: row.bucket.projectId, minor: amounts.get(bucketKey(row.bucket))! }] : []).sort((a, b) => compare(a.projectId, b.projectId)),
    personalMinor: amounts.get('personal') ?? 0,
    unassignedMinor: amounts.get('unassigned') ?? 0,
    unallocatedMinor: amounts.get('residual')!,
    denominatorWeight: denominator.toString(),
    unmeasuredWeight: residual.toString(),
  }
}
