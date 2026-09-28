import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { importSchema, normalize, retainTaskContext } from './normalize'
import { chargeUnits, type Policy } from './money'

// A single transaction lock serialises imports/mapping changes, including overlapping collectors.
export async function costTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(739201681)`
    return fn(tx)
  }, { timeout: 60000, maxWait: 10000 })
}
export async function importUsage(raw: unknown, userId?: string) {
  const input = importSchema.parse(raw)
  const events = normalize(input)
  return costTransaction(async tx => {
    const mappings = await tx.costProjectMapping.findMany()
    const lookup = new Map(mappings.map(m => [`${m.type}:${m.value}`, m.projectId]))
    let added = 0, revised = 0, duplicate = 0, unassigned = 0
    const existingRows = await tx.costUsageEvent.findMany({
      where: { provider: input.provider, accountRef: input.accountRef, sourceKey: { in: events.map(e => e.sourceKey) } },
      include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } },
    })
    const existingByKey = new Map(existingRows.map(e => [e.sourceKey,e]))
    const newEvents: Prisma.CostUsageEventCreateManyInput[] = []
    const newRevisions: Prisma.CostUsageRevisionCreateManyInput[] = []
    for (const row of events) {
      const candidates = [
        row.conversationId && lookup.get(`conversation:${input.accountRef}/${row.conversationId}`),
        row.workspaceRef && lookup.get(`workspace:${row.workspaceRef}`),
        row.resourceRef && lookup.get(`${input.provider}-resource:${row.resourceRef}`),
      ].filter(Boolean) as string[]
      const unique = Array.from(new Set(candidates))
      const projectId = unique.length === 1 ? unique[0] : null
      const attribution = unique.length > 1 ? 'conflict' : projectId ? 'mapped' : 'unassigned'
      const existing = existingByKey.get(row.sourceKey)
      const previous = existing?.revisions[0]
      retainTaskContext(row, previous?.evidence)
      let record = existing ?? {
        id: `cost_${randomUUID()}`, provider: input.provider, accountRef: input.accountRef, sourceKey: row.sourceKey,
        occurredAt: new Date(row.occurredAt), model: row.model, conversationId: row.conversationId,
        workspaceRef: row.workspaceRef, resourceRef: row.resourceRef, projectId, attribution, manualAssignment: false, createdAt: new Date(),
      }
      if (!existing) { newEvents.push(record); added++ }
      // Missing hints never erase a previous attribution. Conflicting positive evidence is held for review.
      if (existing) {
        const conflict = existing.attribution === 'conflict' || unique.length > 1 || (unique.length === 1 && existing.projectId && projectId !== existing.projectId)
        const nextProject = existing.manualAssignment || !unique.length ? existing.projectId : conflict ? null : projectId
        const nextAttribution = existing.manualAssignment || !unique.length ? existing.attribution : conflict ? 'conflict' : attribution
        const nextWorkspace = row.workspaceRef ?? existing.workspaceRef
        const nextResource = row.resourceRef ?? existing.resourceRef
        if (nextProject !== existing.projectId || nextAttribution !== existing.attribution || nextWorkspace !== existing.workspaceRef || nextResource !== existing.resourceRef || row.occurredAt !== existing.occurredAt.toISOString() || row.model !== existing.model) {
          record = { ...existing, ...await tx.costUsageEvent.update({ where: { id: existing.id }, data: {
            projectId: nextProject, attribution: nextAttribution, workspaceRef: nextWorkspace, resourceRef: nextResource,
            occurredAt: row.occurredAt, model: row.model,
          } }) }
          await tx.auditLog.create({data:{userId,action:'costs.event.remap',entityType:'CostUsageEvent',entityId:existing.id,details:JSON.stringify({before:existing.projectId,after:nextProject,attribution:nextAttribution})}})
        }
      }
      if (!record.projectId) unassigned++
      const fx = row.fxGbp ?? (row.currency === previous?.currency ? previous.fxGbp?.toString() : null) ?? null
      // Identity ambiguity cannot be cleared merely by importing a smaller overlapping window.
      if (previous?.reason?.startsWith('Ambiguous identity')) { row.reason = previous.reason; row.quality = 'review' }
      const quality = row.quality === 'review' ? 'review' : previous?.checksum === row.checksum && previous.quality === 'complete' ? 'complete' : row.quality
      if (previous?.checksum === row.checksum && (previous.fxGbp?.toString() ?? null) === (fx === null ? null : new Prisma.Decimal(fx).toString()) && previous.quality === quality) {
        duplicate++
        continue
      }
      if (existing) revised++
      newRevisions.push({
        eventId: record.id, revision: (previous?.revision ?? 0) + 1, checksum: row.checksum,
        funding: row.funding, nominalUnits: row.nominal, providerUnits: row.cash,
        currency: row.currency, fxGbp: fx, quality, reason: row.reason,
        evidence: row.evidence as Prisma.InputJsonValue,
      })
    }
    for (let offset = 0; offset < newEvents.length; offset += 500) await tx.costUsageEvent.createMany({data:newEvents.slice(offset,offset+500)})
    for (let offset = 0; offset < newRevisions.length; offset += 500) await tx.costUsageRevision.createMany({data:newRevisions.slice(offset,offset+500)})
    const result = await tx.costImportRun.create({ data: {
      provider: input.provider, accountRef: input.accountRef, received: events.length,
      added, revised, duplicate, unassigned, quality: input.quality,
    } })
    await tx.auditLog.create({ data: { userId, action: 'costs.import', entityType: 'CostImportRun', entityId: result.id,
      details: JSON.stringify({ provider: input.provider, received: events.length, added, revised, duplicate }) } })
    return { id: result.id, received: events.length, added, revised, duplicate, unassigned, quality: input.quality }
  })
}
export type DatedPolicy = Policy & { id: string; projectId: string | null; clientId: string | null; effectiveAt: Date }
export function resolvePolicy(policies: DatedPolicy[], projectId: string, clientId: string | null, date: Date) {
  const eligible = policies.filter(p => p.effectiveAt <= date).sort((a,b) => b.effectiveAt.getTime() - a.effectiveAt.getTime())
  return eligible.find(p => p.projectId === projectId) ?? eligible.find(p => !p.projectId && clientId && p.clientId === clientId) ?? null
}
export function monthRange(value?: string) {
  const month = value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : new Date().toISOString().slice(0,7)
  const start = new Date(`${month}-01T00:00:00.000Z`)
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 1)
  return { month, start, end }
}
export async function ledger(month?: string, projectId?: string) {
  const range = monthRange(month)
  const [events, policies, projects, imports] = await Promise.all([
    prisma.costUsageEvent.findMany({ where: { occurredAt: { gte: range.start, lt: range.end }, ...(projectId === 'unassigned' ? { projectId: null } : projectId ? { projectId } : {}) },
      include: { project: true, revisions: { orderBy: { revision: 'desc' }, take: 1 } }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 50001 }),
    prisma.costPolicy.findMany(), prisma.costProject.findMany({ orderBy: { name: 'asc' }, include: { client: true } }),
    prisma.costImportRun.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
  ])
  if (events.length > 50000) throw new Error('This month exceeds the interactive limit. Filter by project to see complete totals.')
  const rows = events.map(event => {
    const revision = event.revisions[0]
    const policy = event.project ? resolvePolicy(policies, event.project.id, event.project.clientId, event.occurredAt) : null
    const hold = !revision ? 'Missing revision' : revision.quality !== 'complete' ? revision.reason ?? `Source coverage ${revision.quality}` : !event.project ? `Project ${event.attribution}` : !policy ? 'No effective charging policy' : null
    const charge = !hold && policy && revision ? chargeUnits({ provider: event.provider, funding: revision.funding, nominal: revision.nominalUnits, cash: revision.providerUnits }, policy) : null
    return { event, revision, policy, hold, charge }
  })
  return { ...range, rows, projects, imports }
}
