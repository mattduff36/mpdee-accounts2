import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  createProviderObservation, providerObservationReport, ProviderObservationError,
  type ObservationRow, type ProviderObservationQuery, type ProviderObservationStore,
} from './provider-observations'

export function providerObservationAdapter(tx: Pick<Prisma.TransactionClient, 'costProviderObservation' | 'costProject'>): ProviderObservationStore {
  return {
    findExact: (record, checksum) => tx.costProviderObservation.findUnique({
      where: { provider_accountRef_sourceKey_checksum: {
        provider: record.provider, accountRef: record.accountRef, sourceKey: record.sourceKey, checksum,
      } }, select: { id: true },
    }),
    create: async (record, checksum) => {
      const projectIds = [...new Set(record.groups.flatMap(group => group.projectId ? [group.projectId] : []))]
      if (projectIds.length) {
        const count = await tx.costProject.count({ where: { id: { in: projectIds } } })
        if (count !== projectIds.length) throw new ProviderObservationError(400, 'Choose existing Accounts cost projects')
      }
      return tx.costProviderObservation.create({
        data: {
          provider: record.provider, accountRef: record.accountRef, sourceKey: record.sourceKey,
          checksum, payload: record, observedAt: new Date(record.observedAt),
        }, select: { id: true },
      })
    },
  }
}
export async function saveProviderObservation(raw: unknown) {
  return prisma.$transaction(async tx => {
    // Isolated from financial locks; serialize exact replays before the unique insert.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(739201684)`
    return createProviderObservation(raw, providerObservationAdapter(tx))
  }, { timeout: 15000, maxWait: 10000 })
}
export async function listProviderObservations(query: ProviderObservationQuery) {
  // DISTINCT ON runs in PostgreSQL, before LIMIT; historical corrections cannot crowd out current sources.
  const rows = await prisma.$queryRaw<ObservationRow[]>(Prisma.sql`
    SELECT DISTINCT ON ("provider", "accountRef", "sourceKey") *
    FROM "CostProviderObservation"
    WHERE "provider" = 'vercel'
      ${query.accountRef ? Prisma.sql`AND "accountRef" = ${query.accountRef}` : Prisma.empty}
      ${query.sourceKey ? Prisma.sql`AND "sourceKey" = ${query.sourceKey}` : Prisma.empty}
    ORDER BY "provider", "accountRef", "sourceKey", "observedAt" DESC, "createdAt" DESC, "id" DESC
    LIMIT ${query.limit + 1}
  `)
  return providerObservationReport(rows, query.limit)
}
