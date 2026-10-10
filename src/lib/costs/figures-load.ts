import { prisma } from '@/lib/db'
import { sourceDateFromNotes } from './bill-coverage'
import { countsAsUnassignedProviderCash } from './charge-eligibility'
import { LEDGER_START } from './comparison-policy'
import { currentApprovedTotals, summariseProjects, totalsByCurrency, type CostSummary, type UsageGroup } from './figures'

type GroupRow = {
  slug: string
  name: string
  provider: string
  funding: string
  currency: string
  quality: string
  assigned: boolean
  model: string | null
  sourceKey: string
  coveredByProviderInvoice: boolean
  rows: number
  nominal_units: string | null
  provider_units: string | null
}

/** Native project figures since the ledger start. Unassigned rows are returned separately. */
export async function loadCostFigures(): Promise<CostSummary> {
  const start = new Date(LEDGER_START)
  const [groups, approvedSnapshots, expenses, fxRows, unresolvedExpenses] = await Promise.all([
    prisma.$queryRaw<GroupRow[]>`
      SELECT COALESCE(p.slug, 'unassigned') AS slug, COALESCE(p.name, 'Unassigned') AS name,
        e.provider, r.funding, r.currency, r.quality, (e."projectId" IS NOT NULL) AS assigned,
        e.model AS model, e."sourceKey" AS "sourceKey",
        (r.evidence->>'coveredByProviderInvoice' = 'true') AS "coveredByProviderInvoice",
        COUNT(*)::int AS rows,
        r."nominalUnits"::text AS nominal_units, r."providerUnits"::text AS provider_units
      FROM "CostUsageEvent" e
      LEFT JOIN "CostProject" p ON p.id = e."projectId"
      JOIN LATERAL (SELECT * FROM "CostUsageRevision" WHERE "eventId" = e.id ORDER BY revision DESC LIMIT 1) r ON true
      WHERE e."occurredAt" >= ${start}
      GROUP BY p.slug, p.name, e.provider, r.funding, r.currency, r.quality, e."projectId", e.model, e."sourceKey",
        (r.evidence->>'coveredByProviderInvoice' = 'true'), r."nominalUnits", r."providerUnits"`,
    prisma.costChargeSnapshot.findMany({
      where: { verificationStatus: 'approved' },
      select: { id: true, projectId: true, replacesSnapshotId: true, clientChargePence: true },
    }),
    prisma.expense.findMany({
      where: { isArchived: false, date: { gte: start }, OR: [{ supplier: { contains: 'cursor', mode: 'insensitive' } }, { supplier: { contains: 'vercel', mode: 'insensitive' } }, { supplier: { contains: 'supabase', mode: 'insensitive' } }] },
      select: { grossAmount: true, costAllocations: { select: { project: { select: { slug: true } }, amountPence: true } } },
    }),
    prisma.costUsageRevision.count({ where: { fxGbp: { not: null }, event: { occurredAt: { gte: start } } } }),
    prisma.$queryRaw<{ reference: string | null; gross_pence: number; booked: string; notes: string | null }[]>`
      SELECT COALESCE(reference, 'No reference') AS reference, "grossAmount" AS gross_pence,
        to_char(date, 'YYYY-MM-DD HH24:MI:SS') AS booked, notes
      FROM "Expense"
      WHERE "isArchived" = false
        AND date < TIMESTAMP '2026-08-13 23:00:00'
        AND "billingPeriodStart" IS NULL
        AND (supplier ILIKE '%cursor%' OR supplier ILIKE '%vercel%' OR supplier ILIKE '%supabase%')
      ORDER BY date ASC`,
  ])
  const usage: UsageGroup[] = groups.map(group => ({
    slug: group.slug, name: group.name, provider: group.provider, funding: group.funding, currency: group.currency, quality: group.quality,
    assigned: Boolean(group.assigned), model: group.model, sourceKey: group.sourceKey,
    coveredByProviderInvoice: group.coveredByProviderInvoice === true,
    rows: Number(group.rows),
    nominalUnits: group.nominal_units === null ? null : BigInt(group.nominal_units),
    providerUnits: group.provider_units === null ? null : BigInt(group.provider_units),
  }))
  const slugs = await prisma.costProject.findMany({ select: { id: true, slug: true } })
  const slugById = new Map(slugs.map(project => [project.id, project.slug]))
  const projects = summariseProjects(usage, currentApprovedTotals(approvedSnapshots).flatMap(row => {
    const slug = slugById.get(row.projectId)
    return slug ? [{ slug, approvedPence: row.approvedPence }] : []
  }), expenses.flatMap(expense => expense.costAllocations.flatMap(share => share.project ? [{ slug: share.project.slug, pence: share.amountPence }] : [])))
  const infraGroups = usage.filter(countsAsUnassignedProviderCash)
  const infraRows = infraGroups.reduce((total, group) => total + group.rows, 0)
  const unassignedInfrastructure = totalsByCurrency(infraGroups.map(group => ({ currency: group.currency, rows: group.rows, units: group.providerUnits })))
  const cursorRows = usage.filter(group => !group.assigned && group.provider === 'cursor').reduce((total, group) => total + group.rows, 0)
  const freeCredit = projects.flatMap(project => project.freeCredit)
  const providerBillPence = expenses.reduce((total, expense) => total + expense.grossAmount, 0)
  const allocatedPence = expenses.reduce((total, expense) => total + expense.costAllocations.reduce((sum, share) => sum + share.amountPence, 0), 0)
  return {
    projects,
    unassignedInfrastructureRows: infraRows,
    unassignedInfrastructure,
    unassignedCursorRows: cursorRows,
    freeCreditRows: usage.filter(group => group.funding === 'free-credit').reduce((total, group) => total + group.rows, 0),
    freeCredit,
    missingNominalRows: usage.filter(group => group.provider === 'cursor' && group.nominalUnits === null).reduce((total, group) => total + group.rows, 0),
    providerBills: expenses.length,
    providerBillPence,
    unallocatedBillPence: providerBillPence - allocatedPence,
    unresolvedBills: unresolvedExpenses.map(expense => ({
      reference: expense.reference ?? 'No reference',
      grossPence: Number(expense.gross_pence),
      booked: expense.booked,
      sourceDate: sourceDateFromNotes(expense.notes),
    })),
    usageRowsWithStoredFx: fxRows,
  }
}
