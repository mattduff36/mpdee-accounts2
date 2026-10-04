import { prisma } from '@/lib/db'
import { sourceDateFromNotes } from './bill-coverage'
import { LEDGER_START } from './comparison-policy'
import { summariseProjects, type CostSummary, type UsageGroup } from './figures'

type GroupRow = {
  slug: string
  name: string
  provider: string
  funding: string
  currency: string
  quality: string
  assigned: boolean
  rows: number
  nominal_units: string
  provider_units: string
  missing_nominal: number
}

/** Native project figures since the ledger start. Unassigned rows are returned separately. */
export async function loadCostFigures(): Promise<CostSummary> {
  const start = new Date(LEDGER_START)
  const [groups, snapshots, expenses, fxRows, unresolvedExpenses] = await Promise.all([
    prisma.$queryRaw<GroupRow[]>`
      SELECT COALESCE(p.slug, 'unassigned') AS slug, COALESCE(p.name, 'Unassigned') AS name,
        e.provider, r.funding, r.currency, r.quality, (e."projectId" IS NOT NULL) AS assigned,
        COUNT(*)::int AS rows, COALESCE(SUM(r."nominalUnits"), 0)::text AS nominal_units,
        COALESCE(SUM(r."providerUnits"), 0)::text AS provider_units,
        COUNT(*) FILTER (WHERE r."nominalUnits" IS NULL)::int AS missing_nominal
      FROM "CostUsageEvent" e
      LEFT JOIN "CostProject" p ON p.id = e."projectId"
      JOIN LATERAL (SELECT * FROM "CostUsageRevision" WHERE "eventId" = e.id ORDER BY revision DESC LIMIT 1) r ON true
      WHERE e."occurredAt" >= ${start}
      GROUP BY 1, 2, 3, 4, 5, 6, 7`,
    prisma.costChargeSnapshot.groupBy({ by: ['projectId'], where: { verificationStatus: 'approved' }, _sum: { clientChargePence: true } }),
    prisma.expense.findMany({
      where: { isArchived: false, date: { gte: start }, OR: [{ supplier: { contains: 'cursor', mode: 'insensitive' } }, { supplier: { contains: 'vercel', mode: 'insensitive' } }, { supplier: { contains: 'supabase', mode: 'insensitive' } }] },
      select: { grossAmount: true, costAllocations: { select: { project: { select: { slug: true } }, amountPence: true } } },
    }),
    prisma.costUsageRevision.count({ where: { fxGbp: { not: null }, event: { occurredAt: { gte: start } } } }),
    prisma.expense.findMany({
      where: { isArchived: false, date: { lt: start }, billingPeriodStart: null, OR: [{ supplier: { contains: 'cursor', mode: 'insensitive' } }, { supplier: { contains: 'vercel', mode: 'insensitive' } }, { supplier: { contains: 'supabase', mode: 'insensitive' } }] },
      select: { reference: true, grossAmount: true, date: true, notes: true },
      orderBy: { date: 'asc' },
    }),
  ])
  const usage: UsageGroup[] = groups.map(group => ({
    slug: group.slug, name: group.name, provider: group.provider, funding: group.funding, currency: group.currency, quality: group.quality,
    assigned: Boolean(group.assigned), rows: Number(group.rows), nominalUnits: BigInt(group.nominal_units), providerUnits: BigInt(group.provider_units), missingNominal: Number(group.missing_nominal),
  }))
  const slugs = await prisma.costProject.findMany({ select: { id: true, slug: true } })
  const slugById = new Map(slugs.map(project => [project.id, project.slug]))
  const projects = summariseProjects(usage, snapshots.flatMap(row => {
    const slug = slugById.get(row.projectId)
    return slug ? [{ slug, approvedPence: row._sum.clientChargePence ?? 0 }] : []
  }), expenses.flatMap(expense => expense.costAllocations.flatMap(share => share.project ? [{ slug: share.project.slug, pence: share.amountPence }] : [])))
  const infraGroups = usage.filter(group => !group.assigned && group.funding === 'infrastructure')
  const infraRows = infraGroups.reduce((total, group) => total + group.rows, 0)
  const unassignedInfrastructure = infraRows ? [{ currency: infraGroups[0]?.currency ?? 'USD', units: infraGroups.reduce((total, group) => total + group.providerUnits, BigInt(0)), rows: infraRows, missing: 0 }] : []
  const cursorRows = usage.filter(group => !group.assigned && group.provider === 'cursor').reduce((total, group) => total + group.rows, 0)
  const freeCredit = projects.flatMap(project => project.freeCredit)
  const providerBillPence = expenses.reduce((total, expense) => total + expense.grossAmount, 0)
  const allocatedPence = expenses.reduce((total, expense) => total + expense.costAllocations.reduce((sum, share) => sum + share.amountPence, 0), 0)
  return {
    projects,
    unassignedInfrastructureRows: infraRows,
    unassignedInfrastructure,
    unassignedCursorRows: cursorRows,
    freeCreditRows: usage.filter(group => group.funding === 'unknown' || group.funding === 'free-credit').reduce((total, group) => total + group.rows, 0),
    freeCredit,
    missingNominalRows: usage.reduce((total, group) => total + group.missingNominal, 0),
    providerBills: expenses.length,
    providerBillPence,
    unallocatedBillPence: providerBillPence - allocatedPence,
    unresolvedBills: unresolvedExpenses.map(expense => ({
      reference: expense.reference ?? 'No reference',
      grossPence: expense.grossAmount,
      booked: expense.date.toISOString().slice(0, 19).replace('T', ' '),
      sourceDate: sourceDateFromNotes(expense.notes),
    })),
    usageRowsWithStoredFx: fxRows,
  }
}
