import { createHash } from 'node:crypto'
import { z } from 'zod'
import { decimalUnits, UNIT } from './money'
const amount = z.union([z.number().finite(), z.string().regex(/^-?\d+(\.\d+)?$/)]).nullable().optional()
const token = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional()
const eventSchema = z.object({
  timestamp: z.union([z.string(), z.number()]), model: z.string().max(120).optional(),
  conversationId: z.string().max(160).nullable().optional(), workspaceRef: z.string().max(500).nullable().optional(),
  kind: z.string().max(100).nullable().optional(), isTokenBasedCall: z.boolean().nullable().optional(),
  chargedCents: amount, usageBasedCosts: z.string().max(50).nullable().optional(), cursorTokenFee: amount,
  tokenUsage: z.object({ inputTokens: token, outputTokens: token, cacheReadTokens: token, cacheWriteTokens: token, totalCents: amount }).nullable().optional(),
  sourceId: z.string().min(1).max(200).optional(), resourceRef: z.string().max(250).nullable().optional(),
  nominalAmount: amount, billedAmount: amount, currency: z.enum(['USD','GBP','EUR']).optional(),
  description: z.string().max(300).optional(),
  taskContext: z.object({ method: z.literal('local-topic-rules-v1'), topics: z.array(z.enum(['Interface and usability','Costs and accounting','Database work','Authentication and access','Deployment and infrastructure','Testing and debugging','Scheduling and resources'])).max(3) }).strict().optional(),
})
export const importSchema = z.object({
  version: z.literal('mpdee-costs-v1').optional(), provider: z.enum(['cursor','vercel','supabase','manual']).default('cursor'),
  accountRef: z.string().min(3).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  quality: z.enum(['complete','partial','unknown']).default('unknown'),
  fxGbp: z.string().regex(/^\d+(\.\d{1,8})?$/).optional(),
  events: z.array(eventSchema).max(5000),
})
export type ImportPayload = z.infer<typeof importSchema>
export type Normalized = ReturnType<typeof normalize>[number]
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
// Exact provider labels for subscription-covered usage; never infer from plan spend.
const INCLUDED_CURSOR_KINDS = new Set(['USAGE_EVENT_KIND_INCLUDED_IN_ULTRA', 'USAGE_EVENT_KIND_INCLUDED_IN_PRO', 'USAGE_EVENT_KIND_INCLUDED_IN_PRO_PLUS'])
export function normalize(input: ImportPayload) {
  if (input.fxGbp && (Number(input.fxGbp) <= 0 || Number(input.fxGbp) > 100)) throw new Error('Invalid GBP exchange rate')
  const counts = new Map<string, number>()
  const parsed = input.events.map(event => {
    const rawTime = String(event.timestamp)
    const date = new Date(/^\d{13}$/.test(rawTime) ? Number(rawTime) : rawTime)
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid event date')
    const occurredAt = date.toISOString()
    const baseKey = input.provider === 'cursor'
      ? hash([occurredAt, event.model ?? '', event.conversationId ?? '', event.isTokenBasedCall ?? ''].join('|'))
      : event.sourceId
    if (!baseKey) throw new Error('Infrastructure imports require a stable sourceId (invoice line or provider bucket ID)')
    counts.set(baseKey, (counts.get(baseKey) ?? 0) + 1)
    return { event, occurredAt, baseKey }
  })
  const occurrences = new Map<string, number>()
  return parsed.map(({ event, occurredAt, baseKey }) => {
    const occurrence = occurrences.get(baseKey) ?? 0
    occurrences.set(baseKey, occurrence + 1)
    const sourceKey = `${baseKey}:${occurrence}`
    let funding = 'infrastructure'
    let nominal: bigint | null = null
    let cash: bigint | null = null
    let reason: string | null = null
    const currency = input.provider === 'cursor' ? 'USD' : event.currency ?? 'USD'
    if (input.provider === 'cursor') {
      funding = INCLUDED_CURSOR_KINDS.has(event.kind ?? '') ? 'included' : event.kind === 'USAGE_EVENT_KIND_USAGE_BASED' ? 'on-demand' : 'unknown'
      nominal = event.tokenUsage?.totalCents == null ? null : decimalUnits(event.tokenUsage.totalCents, 5)
      cash = funding === 'included' ? BigInt(0) : event.chargedCents == null ? null : decimalUnits(event.chargedCents, 5)
      if (funding === 'unknown') reason = 'Unknown funding label'
      if (nominal === null || cash === null) reason = 'Missing provider monetary value; review required'
      if ((nominal !== null && nominal < BigInt(0)) || (cash !== null && cash < BigInt(0))) throw new Error('Negative Cursor usage must be imported as a reviewed adjustment')
      if (event.cursorTokenFee && Number(event.cursorTokenFee) !== 0) reason = 'Nonzero Cursor fee requires reconciliation'
      if (funding === 'on-demand' && cash !== null && /^\$?\d+(\.\d+)?$/.test(event.usageBasedCosts ?? '')) {
        const display = decimalUnits(event.usageBasedCosts!.replace('$',''))
        if ((cash > display ? cash - display : display - cash) > UNIT / BigInt(100)) reason = 'Displayed and precise provider cost differ by more than one cent'
      }
    } else {
      cash = event.billedAmount == null ? null : decimalUnits(event.billedAmount)
      nominal = event.nominalAmount == null ? cash : decimalUnits(event.nominalAmount)
      if (cash === null) reason = 'Missing provider billed amount'
    }
    if ((counts.get(baseKey) ?? 0) > 1) reason = 'Ambiguous identity collision; review required'
    const fxGbp = currency === 'GBP' ? '1' : input.fxGbp ?? null
    const evidence = { ...event, timestamp: occurredAt }
    const checksum = revisionChecksum({ funding, nominal, cash, currency, occurredAt, evidence, reason })
    return { sourceKey, occurredAt, model: event.model ?? null, conversationId: event.conversationId ?? null, workspaceRef: event.workspaceRef ?? null, resourceRef: event.resourceRef ?? null, funding, nominal, cash, currency, fxGbp, evidence, checksum, quality: reason ? 'review' : input.quality, reason }
  })
}

function revisionChecksum(row: { funding: string; nominal: bigint | null; cash: bigint | null; currency: string; occurredAt: string; evidence: ImportPayload['events'][number]; reason: string | null }) {
  const event = row.evidence
  return hash(JSON.stringify({ funding: row.funding, nominal: row.nominal?.toString(), cash: row.cash?.toString(), currency: row.currency, occurredAt: row.occurredAt, model: event.model, description: event.description, taskContext: event.taskContext, reason: row.reason, tokens: event.tokenUsage && [event.tokenUsage.inputTokens,event.tokenUsage.outputTokens,event.tokenUsage.cacheReadTokens,event.tokenUsage.cacheWriteTokens] }))
}
// Older outbox payloads must not erase local context or repeatedly create revisions.
// Validate stored evidence too; never copy an arbitrary JSON object into the new row.
export function retainTaskContext(row: Normalized, priorEvidence: unknown) {
  if (row.evidence.taskContext || !priorEvidence || typeof priorEvidence !== 'object' || Array.isArray(priorEvidence)) return
  const parsed = eventSchema.shape.taskContext.safeParse((priorEvidence as Record<string, unknown>).taskContext)
  if (!parsed.success || !parsed.data) return
  row.evidence.taskContext = parsed.data
  row.checksum = revisionChecksum(row)
}
