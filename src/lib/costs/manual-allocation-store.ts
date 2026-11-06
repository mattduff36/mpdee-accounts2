import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { quoteFor, type FxQuote } from './fx-values'
import { decimalUnits, roundRatio } from './money'
import {
  MANUAL_ALLOCATION_VERSION, ManualAllocationError, manualAllocationState, saveManualAllocation,
  allocatedSourceAmounts, type AllocationShare, type ManualAllocationQuery, type ManualSourceKind,
} from './manual-allocation'
import { summarizeManualAllocations } from './manual-allocation-report'

export const manualAllocationInclude = {
  history: { orderBy: { revision: 'desc' }, take: 1, include: { shares: { include: { project: { select: { id: true, name: true, slug: true } } } } } },
} satisfies Prisma.CostManualAllocationInclude

type StoredAllocation = {
  revision: number
  history: { revision: number; unallocatedBps: number; shares: AllocationShare[] }[]
}
export function stateFromAllocation(allocation: StoredAllocation | null, defaultProjectId?: string) {
  if (!allocation) return manualAllocationState(null, defaultProjectId)
  const latest = allocation.history[0]
  if (!latest || latest.revision !== allocation.revision) throw new Error('Allocation audit revision is missing')
  const state = manualAllocationState({ revision: allocation.revision, shares: latest.shares.map(({ projectId, shareBps }) => ({ projectId, shareBps })) })
  if (state.unallocatedBps !== latest.unallocatedBps) throw new Error('Allocation audit remainder is inconsistent')
  return state
}

export async function persistManualAllocation(raw: unknown, actorId: string) {
  return prisma.$transaction(async tx => {
    // This lock never participates in source imports. It also serializes first-save revision zero.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(739201684)`
    return saveManualAllocation(raw, actorId, {
      sourceExists: async (kind, id) => Boolean(kind === 'subscription_invoice'
        ? await tx.costSubscriptionInvoice.findUnique({ where: { id }, select: { id: true } })
        : await tx.costCustomRecurring.findUnique({ where: { id }, select: { id: true } })),
      currentRevision: async (sourceKind, sourceId) => (await tx.costManualAllocation.findUnique({
        where: { sourceKind_sourceId: { sourceKind, sourceId } }, select: { revision: true },
      }))?.revision ?? 0,
      projectsExist: async ids => await tx.costProject.count({ where: { id: { in: ids } } }) === ids.length,
      commit: async (input, userId) => {
        const where = { sourceKind_sourceId: { sourceKind: input.sourceKind, sourceId: input.sourceId } }
        let allocationId: string
        if (input.expectedRevision === 0) {
          const row = await tx.costManualAllocation.create({ data: {
            sourceKind: input.sourceKind, sourceId: input.sourceId, revision: 1,
            ...(input.sourceKind === 'subscription_invoice' ? { subscriptionInvoiceId: input.sourceId } : { recurringId: input.sourceId }),
          } })
          allocationId = row.id
        } else {
          const changed = await tx.costManualAllocation.updateMany({
            where: { sourceKind: input.sourceKind, sourceId: input.sourceId, revision: input.expectedRevision },
            data: { revision: { increment: 1 } },
          })
          if (changed.count !== 1) throw new ManualAllocationError(409, 'Allocation changed; reload before editing')
          allocationId = (await tx.costManualAllocation.findUniqueOrThrow({ where })).id
        }
        const state = manualAllocationState({ revision: input.expectedRevision + 1, shares: input.shares })
        await tx.costManualAllocationRevision.create({ data: {
          allocationId, revision: state.revision, actorId: userId, version: MANUAL_ALLOCATION_VERSION,
          basis: 'user_selected', unallocatedBps: state.unallocatedBps,
          shares: { create: state.shares },
        } })
        return { version: MANUAL_ALLOCATION_VERSION, ...state }
      },
    })
  }, { timeout: 15000, maxWait: 10000 })
}

export async function storedRecurringQuotes(date: string, db: Prisma.TransactionClient = prisma): Promise<FxQuote[]> {
  const rows = await db.costFxRate.findMany({ where: {
    date: { gte: new Date(Date.parse(`${date}T00:00:00Z`) - 7 * 86400000), lte: new Date(`${date}T00:00:00Z`) },
  } })
  return rows.map(row => ({ currency: row.currency, date: row.date.toISOString().slice(0, 10), rate: row.gbpRate.toString(), source: row.source }))
}
export function recurringGbpEstimate(amountMinor: number, currency: string, date: string, quotes: FxQuote[]) {
  const quote = quoteFor(quotes, currency, date)
  if (!quote) return { gbpEstimatePence: null, fx: null }
  const rate = decimalUnits(quote.rate, 8)
  if (rate <= BigInt(0)) throw new Error('Stored reference FX rate must be positive')
  const pence = roundRatio(BigInt(amountMinor) * rate, BigInt(100000000))
  if (pence > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('GBP estimate exceeds safe integer range')
  return { gbpEstimatePence: Number(pence), fx: quote }
}

export async function listManualAllocationReport(query: ManualAllocationQuery) {
  return prisma.$transaction(async tx => {
    const whereId = query.sourceId ? { id: query.sourceId } : query.after ? { id: { gt: query.after } } : {}
    const common = { orderBy: { id: 'asc' as const }, take: query.limit + 1 }
    const records = []
    if (query.sourceKind === 'subscription_invoice') {
      const rows = await tx.costSubscriptionInvoice.findMany({
        ...common, where: whereId, include: { manualAllocation: { include: manualAllocationInclude } },
      })
      for (const row of rows) {
        const state = stateFromAllocation(row.manualAllocation)
        const names = new Map(row.manualAllocation?.history[0]?.shares.map(share => [share.projectId, share.project]) ?? [])
        records.push({
          sourceKind: 'subscription_invoice' as ManualSourceKind, sourceId: row.id,
          label: `${row.provider} / ${row.invoiceNumber}`, currency: row.currency, amountMinor: row.grossMinor,
          gbpEstimatePence: row.gbpEstimatePence, amountBasis: 'confirmed_invoice_gross',
          periodStart: row.periodStart.toISOString().slice(0, 10), periodEnd: row.periodEnd.toISOString().slice(0, 10),
          fx: { rate: row.fxRate.toString(), date: row.fxDate.toISOString().slice(0, 10), source: row.fxSource },
          allocation: state,
          buckets: allocatedSourceAmounts(row.grossMinor, row.gbpEstimatePence, state).map(bucket => ({
            ...bucket, project: bucket.projectId === null ? null : names.get(bucket.projectId) ?? null,
          })),
        })
      }
    } else {
      const rows = await tx.costCustomRecurring.findMany({
        ...common, where: {
          ...whereId, active: true, effectiveStart: { lte: new Date(query.asOf) },
          OR: [{ effectiveEnd: null }, { effectiveEnd: { gt: new Date(query.asOf) } }],
        },
        include: { project: { select: { id: true, slug: true, name: true } }, manualAllocation: { include: manualAllocationInclude } },
      })
      const quotes = await storedRecurringQuotes(query.asOf, tx)
      for (const row of rows) {
        const state = stateFromAllocation(row.manualAllocation, row.projectId)
        const names = new Map(row.manualAllocation?.history[0]?.shares.map(share => [share.projectId, share.project]) ?? [])
        names.set(row.projectId, row.project)
        const estimate = recurringGbpEstimate(row.amountMinor, row.currency, query.asOf, quotes)
        records.push({
          sourceKind: 'custom_recurring' as ManualSourceKind, sourceId: row.id,
          label: `${row.provider} / ${row.name}`, currency: row.currency, amountMinor: row.amountMinor,
          ...estimate, amountBasis: 'monthly_commitment_not_payment',
          periodStart: row.effectiveStart.toISOString().slice(0, 10), periodEnd: row.effectiveEnd?.toISOString().slice(0, 10) ?? null,
          allocation: state,
          buckets: allocatedSourceAmounts(row.amountMinor, estimate.gbpEstimatePence, state).map(bucket => ({
            ...bucket, project: bucket.projectId === null ? null : names.get(bucket.projectId) ?? null,
          })),
        })
      }
    }
    const page = records.slice(0, query.limit)
    return {
      version: 'mpdee-manual-allocation-report-v1', sourceKind: query.sourceKind, asOf: query.asOf,
      scope: query.sourceKind === 'subscription_invoice' ? 'invoice_only' : 'active_monthly_commitment_as_of',
      additiveToExistingCosts: false, allocationEvidence: 'user_selected_not_measured_usage',
      records: page, pageTotals: summarizeManualAllocations(page),
      nextCursor: records.length > query.limit ? page[page.length - 1].sourceId : null,
    }
  }, { isolationLevel: 'RepeatableRead', timeout: 15000, maxWait: 10000 })
}
