import type { CostCustomRecurring, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  createCustomRecurring, editCustomRecurring, recurringFields, CustomRecurringError,
  type CustomRecurringActor, type CustomRecurringFields, type CustomRecurringQuery, type CustomRecurringStore,
} from './custom-recurring'

export function customRecurringDto(row: CostCustomRecurring & { project: { slug: string; name: string } }) {
  return {
    id: row.id, sourceKey: row.sourceKey, projectId: row.projectId,
    project: { slug: row.project.slug, name: row.project.name },
    provider: row.provider, name: row.name, currency: row.currency, amountMinor: row.amountMinor,
    recurrence: row.recurrence, effectiveStart: row.effectiveStart.toISOString().slice(0, 10),
    effectiveEnd: row.effectiveEnd?.toISOString().slice(0, 10) ?? null, active: row.active,
    revision: row.revision, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    evidenceKind: 'owner_entered_commitment', paymentStatus: 'unknown', taxStatus: 'unknown',
  }
}
export type CustomRecurringDto = ReturnType<typeof customRecurringDto>
export async function listCustomRecurring(query: CustomRecurringQuery) {
  const rows = await prisma.costCustomRecurring.findMany({
    where: { projectId: query.projectId, ...(query.after ? { id: { gt: query.after } } : {}) },
    orderBy: { id: 'asc' }, take: query.limit + 1,
    include: { project: { select: { slug: true, name: true } } },
  })
  const records = rows.slice(0, query.limit).map(customRecurringDto)
  return {
    version: 'mpdee-custom-recurring-list-v1', records,
    nextCursor: rows.length > query.limit ? records[records.length - 1].id : null,
  }
}
function databaseFields(record: CustomRecurringFields) {
  return {
    ...recurringFields(record), effectiveStart: new Date(record.effectiveStart),
    effectiveEnd: record.effectiveEnd ? new Date(record.effectiveEnd) : null,
  }
}
function adapter(tx: Prisma.TransactionClient, actor: CustomRecurringActor): CustomRecurringStore {
  async function projectExists(projectId: string) {
    if (!await tx.costProject.findUnique({ where: { id: projectId }, select: { id: true } })) {
      throw new CustomRecurringError(400, 'Choose an existing cost project')
    }
  }
  async function audit(row: CostCustomRecurring, fields: CustomRecurringFields) {
    await tx.costCustomRecurringRevision.create({ data: {
      recurringId: row.id, revision: row.revision, ...actor,
      snapshot: { sourceKey: row.sourceKey, ...recurringFields(fields) },
    } })
  }
  return {
    findSource: sourceKey => tx.costCustomRecurring.findUnique({ where: { sourceKey } }),
    findId: id => tx.costCustomRecurring.findUnique({ where: { id } }),
    create: async (record, importChecksum) => {
      await projectExists(record.projectId)
      const row = await tx.costCustomRecurring.create({ data: {
        sourceKey: record.sourceKey, importChecksum, ...databaseFields(record),
      } })
      await audit(row, record)
      return row
    },
    update: async record => {
      await projectExists(record.projectId)
      const changed = await tx.costCustomRecurring.updateMany({
        where: { id: record.id, revision: record.expectedRevision },
        data: { ...databaseFields(record), revision: { increment: 1 } },
      })
      if (changed.count !== 1) throw new CustomRecurringError(409, 'Recurring cost changed; reload before editing')
      const row = await tx.costCustomRecurring.findUniqueOrThrow({ where: { id: record.id } })
      await audit(row, record)
      return row
    },
  }
}
export async function saveCustomRecurring(raw: unknown, actor: CustomRecurringActor, mode: 'create' | 'edit') {
  return prisma.$transaction(async tx => {
    // Separate from legacy cost locks; serializes concurrent imports of the same source.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(739201683)`
    const store = adapter(tx, actor)
    return mode === 'create' ? createCustomRecurring(raw, store) : editCustomRecurring(raw, store)
  }, { timeout: 15000, maxWait: 10000 })
}
