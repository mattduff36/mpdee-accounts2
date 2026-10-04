import { prisma } from '@/lib/db'
import { fetchReferenceRates } from './fx'
import { quoteFor, referenceYears, type FxQuote } from './fx-values'
import {
  estimateEvent,
  presentProvisionalEstimate,
  provisionalComparisonEstimate,
  type ExclusionBucket,
  type NativeAmount,
  type PresentedEstimate,
  type ProvisionalEstimate,
  type RatePolicy,
} from './provisional-estimate'

type UsageRow = {
  provider: string
  account_ref: string
  source_key: string
  occurred_at: string
  revision: number
  revision_at: string
  funding: string
  nominal_units: string | null
  provider_units: string | null
  currency: string
  quality: string
  attribution: string
  resource_ref: string | null
  fx_gbp: string | null
  covered: string | null
}

type PolicyRow = {
  scope: string
  effective_at: string
  effective_until: string | null
  billable: boolean
  included_base_bps: number
  markup_bps: number
  infrastructure_markup_bps: number
  vercel_daily_pence: number
}

type GroupRow = { currency: string; rows: number; nominal_units: string; provider_units: string }

export type LoadedComparison = {
  estimate: ProvisionalEstimate
  presentation: PresentedEstimate
  infrastructureRowsInDatabase: number
}

function summed(rows: GroupRow[], field: 'nominal_units' | 'provider_units'): NativeAmount[] {
  const map = new Map<string, NativeAmount>()
  for (const row of rows) {
    const current = map.get(row.currency) ?? { currency: row.currency, units: BigInt(0), rows: 0 }
    current.units += BigInt(row[field])
    current.rows += Number(row.rows)
    map.set(row.currency, current)
  }
  return Array.from(map.values())
}

async function quotesFor(events: { currency: string; occurredAt: string; recordedFx?: string | null }[]) {
  const dates = events.map(event => event.occurredAt.slice(0, 10)).sort()
  if (!dates.length) return [] as FxQuote[]
  const stored = await prisma.$queryRaw<{ currency: string; rate_date: string; rate: string; source: string }[]>`
    SELECT currency, to_char(date, 'YYYY-MM-DD') AS rate_date, "gbpRate"::text AS rate, source
    FROM "CostFxRate"
    WHERE date >= ${new Date(Date.parse(`${dates[0]}T00:00:00.000Z`) - 7 * 86400000)}::date
      AND date <= ${new Date(`${dates[dates.length - 1]}T00:00:00.000Z`)}::date`
  const quotes: FxQuote[] = stored.map(rate => ({ currency: rate.currency, date: rate.rate_date, rate: rate.rate, source: rate.source }))
  const missing = events.filter(event => event.currency !== 'GBP' && !event.recordedFx && !quoteFor(quotes, event.currency, event.occurredAt.slice(0, 10)))
  for (const year of referenceYears(missing.map(event => new Date(event.occurredAt)))) {
    try { quotes.push(...await fetchReferenceRates(year)) } catch { /* A failed reference year leaves those rows unavailable. */ }
  }
  return quotes
}

/** Latest project rows in the connected database. Infrastructure counts only when that database stores it. */
export async function loadProjectComparisonEstimate(slug: string): Promise<LoadedComparison | null> {
  const asOf = new Date().toISOString()
  const projects = await prisma.$queryRaw<{ slug: string }[]>`SELECT slug FROM "CostProject" WHERE slug = ${slug} AND archived = false`
  if (!projects.length) return null
  const [usage, policies, unassigned, infrastructure] = await Promise.all([
    prisma.$queryRaw<UsageRow[]>`
      SELECT e.provider, e."accountRef" AS account_ref, e."sourceKey" AS source_key,
        to_char(e."occurredAt", 'YYYY-MM-DD HH24:MI:SS') AS occurred_at,
        r.revision, to_char(r."createdAt", 'YYYY-MM-DD HH24:MI:SS.MS') AS revision_at,
        r.funding, r."nominalUnits"::text AS nominal_units, r."providerUnits"::text AS provider_units,
        r.currency, r.quality, e.attribution, e."resourceRef" AS resource_ref, r."fxGbp"::text AS fx_gbp,
        r.evidence->>'coveredByProviderInvoice' AS covered
      FROM "CostUsageEvent" e
      JOIN "CostProject" p ON p.id = e."projectId"
      JOIN LATERAL (
        SELECT * FROM "CostUsageRevision" WHERE "eventId" = e.id ORDER BY revision DESC LIMIT 1
      ) r ON true
      WHERE p.slug = ${slug} AND e."occurredAt" >= TIMESTAMP '2026-08-13 23:00:00'`,
    prisma.$queryRaw<PolicyRow[]>`
      SELECT CASE WHEN pol."projectId" IS NULL THEN 'client' ELSE 'project' END AS scope,
        to_char(pol."effectiveAt", 'YYYY-MM-DD HH24:MI:SS') AS effective_at,
        to_char(pol."effectiveUntil", 'YYYY-MM-DD HH24:MI:SS') AS effective_until,
        pol.billable, pol."includedBaseBps" AS included_base_bps, pol."markupBps" AS markup_bps,
        pol."infrastructureMarkupBps" AS infrastructure_markup_bps, pol."vercelDailyPence" AS vercel_daily_pence
      FROM "CostPolicy" pol
      WHERE pol."projectId" = (SELECT id FROM "CostProject" WHERE slug = ${slug})
         OR (pol."clientId" IS NOT NULL AND pol."clientId" = (SELECT "clientId" FROM "CostProject" WHERE slug = ${slug}))`,
    prisma.$queryRaw<GroupRow[]>`
      SELECT r.currency, COUNT(*)::int AS rows,
        COALESCE(SUM(r."nominalUnits"), 0)::text AS nominal_units,
        COALESCE(SUM(r."providerUnits"), 0)::text AS provider_units
      FROM "CostUsageEvent" e
      JOIN LATERAL (
        SELECT currency, "nominalUnits", "providerUnits" FROM "CostUsageRevision" WHERE "eventId" = e.id ORDER BY revision DESC LIMIT 1
      ) r ON true
      WHERE e."projectId" IS NULL AND e.provider = 'cursor' AND e."occurredAt" >= TIMESTAMP '2026-08-13 23:00:00'
      GROUP BY r.currency`,
    prisma.$queryRaw<{ rows: number }[]>`
      SELECT COUNT(*)::int AS rows FROM "CostUsageEvent"
      WHERE provider IN ('vercel', 'supabase', 'manual') AND "occurredAt" >= TIMESTAMP '2026-08-13 23:00:00'`,
  ])
  const events = usage.map(row => estimateEvent({
    provider: row.provider, accountRef: row.account_ref, sourceKey: row.source_key, occurredClock: row.occurred_at,
    revision: Number(row.revision), revisionClock: row.revision_at, funding: row.funding,
    nominalUnits: row.nominal_units === null ? null : BigInt(row.nominal_units),
    providerUnits: row.provider_units === null ? null : BigInt(row.provider_units),
    currency: row.currency, quality: row.quality, attribution: row.attribution, resourceRef: row.resource_ref,
    recordedFx: row.fx_gbp, coveredByProviderInvoice: row.covered === 'true', provenance: 'live',
  }))
  const quotes = await quotesFor(events)
  const extra: ExclusionBucket = {
    key: 'unassigned-cursor', label: 'Unassigned Cursor usage',
    rows: unassigned.reduce((total, row) => total + Number(row.rows), 0),
    nominal: summed(unassigned, 'nominal_units'), recordedProvider: summed(unassigned, 'provider_units'),
    reason: 'Unassigned Cursor usage stays out of the iTrader charge.',
  }
  const storedPolicies: RatePolicy[] = policies.filter(policy => policy.scope === 'project' || policy.scope === 'client').map(policy => ({
    scope: policy.scope as RatePolicy['scope'],
    effectiveAt: `${policy.effective_at.replace(' ', 'T')}.000Z`,
    effectiveUntil: policy.effective_until ? `${policy.effective_until.replace(' ', 'T')}.000Z` : null,
    billable: Boolean(policy.billable),
    includedBaseBps: Number(policy.included_base_bps), markupBps: Number(policy.markup_bps),
    infrastructureMarkupBps: Number(policy.infrastructure_markup_bps), vercelDailyPence: Number(policy.vercel_daily_pence),
  }))
  const estimate = provisionalComparisonEstimate({ asOf, events, referenceQuotes: quotes, storedPolicies, extraExclusions: [extra] })
  const infrastructureRowsInDatabase = Number(infrastructure[0]?.rows ?? 0)
  return { estimate, presentation: presentProvisionalEstimate(estimate, { infrastructureRowsInDatabase }), infrastructureRowsInDatabase }
}
