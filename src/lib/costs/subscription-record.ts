import { createHash } from 'node:crypto'
import { z } from 'zod'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(s+'T00:00:00Z')
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === s
}, 'Invalid date')
const minor = z.number().int().nonnegative().max(2_000_000_000)
const identity = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/)
export const subscriptionRecordSchema = z.object({
  version: z.literal('mpdee-subscription-v1'),
  provider: z.literal('openai'), accountRef: identity, invoiceNumber: identity,
  product: z.string().min(1).max(120), currency: z.enum(['USD','GBP','EUR']),
  netMinor: minor, taxMinor: minor, grossMinor: minor,
  invoiceDate: date, paymentDate: date, periodStart: date, periodEnd: date,
  paymentStatus: z.literal('paid'), allocationStatus: z.literal('unallocated'),
  gbpEstimatePence: minor,
  fxRate: z.string().regex(/^\d{1,3}(\.\d{1,16})?$/).refine(s => Number(s)>0),
  fxDate: date,
  fxSource: z.string().url().max(500).refine(s => {
    const u=new URL(s);return u.protocol==='https:' && !u.username && !u.password && !u.search && !u.hash
  }),
  evidence: z.object({method:z.literal('signed_in_invoice_review'), reference:identity}).strict(),
}).strict().superRefine((r,ctx) => {
  if(r.netMinor+r.taxMinor!==r.grossMinor)ctx.addIssue({code:'custom',message:'Invoice amounts do not balance'})
  if(r.periodEnd<=r.periodStart)ctx.addIssue({code:'custom',message:'Service period must be nonempty; end is exclusive'})
  if(r.paymentDate<r.invoiceDate)ctx.addIssue({code:'custom',message:'Payment precedes invoice'})
  const age=(Date.parse(r.paymentDate)-Date.parse(r.fxDate))/86400000
  if(age<0 || age>7)ctx.addIssue({code:'custom',message:'FX quote must be on or within seven days before payment'})
  const [whole,fraction='']=r.fxRate.split('.')
  const scale=10n**BigInt(fraction.length)
  const rate=BigInt(whole)*scale+BigInt(fraction||'0')
  const expected=(BigInt(r.grossMinor)*rate+scale/2n)/scale
  if(expected!==BigInt(r.gbpEstimatePence))ctx.addIssue({code:'custom',message:'GBP estimate does not match reference conversion'})
})
export function normalizeSubscriptionRecord(raw:unknown) {
  const record=subscriptionRecordSchema.parse(raw)
  // Parsed schema has deterministic key order; observations never enter identity.
  return {record,checksum:createHash('sha256').update(JSON.stringify(record)).digest('hex')}
}
export class SubscriptionConflict extends Error {}
export type SubscriptionStore = {
  find: (record: ReturnType<typeof normalizeSubscriptionRecord>['record']) => Promise<{id:string;checksum:string}|null>
  create: (value: ReturnType<typeof normalizeSubscriptionRecord>) => Promise<{id:string}>
}
/** Caller serializes this operation in a transaction. Conflicts never overwrite evidence. */
export async function saveSubscriptionRecord(raw:unknown, store:SubscriptionStore) {
  const normalized=normalizeSubscriptionRecord(raw)
  const existing=await store.find(normalized.record)
  if(existing) {
    if(existing.checksum!==normalized.checksum)throw new SubscriptionConflict('Invoice identity already has different evidence')
    return {version:'mpdee-subscription-ack-v1',status:'duplicate',id:existing.id,checksum:normalized.checksum}
  }
  const created=await store.create(normalized)
  return {version:'mpdee-subscription-ack-v1',status:'added',id:created.id,checksum:normalized.checksum}
}
