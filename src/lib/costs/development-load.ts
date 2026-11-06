import { prisma } from '@/lib/db'
import { buildDevelopmentReport, developmentEventQuery, type DevelopmentEvent, type DevelopmentQuery } from './development-report'

export async function loadDevelopmentReport(
  query: DevelopmentQuery,
  read: (args: ReturnType<typeof developmentEventQuery>) => Promise<DevelopmentEvent[]> = args => prisma.costUsageEvent.findMany(args),
) {
  return buildDevelopmentReport(await read(developmentEventQuery(query)), query)
}
