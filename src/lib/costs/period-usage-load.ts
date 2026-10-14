import { showsConfirmedProviderCash } from './charge-eligibility'
import { loadCalculationSettings } from './calculation-settings-load'
import { dailyHostingFees } from './daily-hosting'
import { ledgerFx } from './fx'
import { convertUnits } from './fx-values'
import { chargeUnits, type Policy } from './money'
import { prisma } from '@/lib/db'
import { resolvePolicy, type DatedPolicy } from './service'
import { combineGbp, mergeMoney, summarisePeriodUsage, type AmountSlice, type GbpCoverage, type PeriodProjectTotal } from './period-usage'
import type { MoneyTotal } from './figures'

const EVENT_CAP = 20000

export type ClientPeriodProject = PeriodProjectTotal & {
  name: string
  slug: string
  hostingDays: number
  hostingPence: number
}

export type ClientPeriodReport = {
  from: string
  to: string
  fxUnavailable: boolean
  projects: ClientPeriodProject[]
  totals: {
    events: number
    held: number
    nominal: MoneyTotal[]
    confirmed: MoneyTotal[]
    charge: MoneyTotal[]
    nominalGbp: GbpCoverage
    confirmedGbp: GbpCoverage
    chargeGbp: GbpCoverage
    hostingDays: number
    hostingPence: number
  }
}

function covered(evidence: unknown) {
  return !!evidence && typeof evidence === 'object' && !Array.isArray(evidence) && (evidence as { coveredByProviderInvoice?: unknown }).coveredByProviderInvoice === true
}

function slice(units: bigint | null, gbp: bigint | null): AmountSlice {
  return { units, gbp }
}

export async function loadClientPeriod(input: { clientId: string; from: string; to: string; start: Date; endExclusive: Date; projectId?: string }): Promise<ClientPeriodReport | { error: string }> {
  const projects = await prisma.costProject.findMany({
    where: { clientId: input.clientId, archived: false },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, slug: true, clientId: true },
  })
  const selected = input.projectId ? projects.filter(project => project.id === input.projectId) : projects
  if (input.projectId && !selected.length) return { error: 'That project is not linked to this client.' }
  const ids = selected.map(project => project.id)
  const count = ids.length ? await prisma.costUsageEvent.count({ where: { projectId: { in: ids }, occurredAt: { gte: input.start, lt: input.endExclusive } } }) : 0
  if (count > EVENT_CAP) return { error: `This period has ${count.toLocaleString('en-GB')} assigned events. Shorten the dates so the total stays complete.` }
  const [events, policies, settings] = await Promise.all([
    ids.length ? prisma.costUsageEvent.findMany({
      where: { projectId: { in: ids }, occurredAt: { gte: input.start, lt: input.endExclusive } },
      include: { revisions: { orderBy: { revision: 'desc' }, take: 1, select: { funding: true, quality: true, currency: true, nominalUnits: true, providerUnits: true, fxGbp: true, evidence: true, reason: true } } },
    }) : Promise.resolve([]),
    prisma.costPolicy.findMany(),
    loadCalculationSettings(),
  ])
  const fx = await ledgerFx(events.map(event => ({ event, revision: event.revisions[0] })))
  const measures = events.flatMap((event, index) => {
    if (!event.projectId) return []
    const revision = event.revisions[0]
    const project = selected.find(item => item.id === event.projectId)
    if (!project) return []
    const dated = resolvePolicy(policies as DatedPolicy[], project.id, project.clientId, event.occurredAt)
    const policy: (DatedPolicy & { rates: Policy['rates'] }) | null = dated ? { ...dated, rates: settings.resolve(project.id).rates } : null
    const qualityHold = !revision ? 'Missing revision' : revision.quality !== 'complete' ? revision.reason ?? `Source coverage ${revision.quality}` : !policy ? 'No effective charging policy' : null
    const charge = !qualityHold && policy && revision ? chargeUnits({ provider: event.provider, funding: revision.funding, nominal: revision.nominalUnits, cash: revision.providerUnits, model: event.model }, policy) : null
    const held = Boolean(qualityHold || charge === null)
    const quote = fx.quotes[index] ?? null
    const currency = revision?.currency ?? 'USD'
    const confirmed = !!revision && showsConfirmedProviderCash({ provider: event.provider, funding: revision.funding, quality: revision.quality, sourceKey: event.sourceKey, coveredByProviderInvoice: covered(revision.evidence) })
    return [{
      projectId: project.id,
      currency,
      nominal: event.provider === 'cursor' && revision ? slice(revision.nominalUnits, convertUnits(revision.nominalUnits, quote)) : null,
      confirmed: confirmed && revision ? slice(revision.providerUnits, convertUnits(revision.providerUnits, quote)) : null,
      charge: held || !revision ? null : slice(charge, convertUnits(charge, quote)),
    }]
  })
  const totals = summarisePeriodUsage(measures)
  const today = new Date().toISOString().slice(0, 10)
  const rows: ClientPeriodProject[] = selected.map(project => {
    const usage = totals.get(project.id) ?? {
      projectId: project.id, events: 0, held: 0, nominal: [], confirmed: [], charge: [],
      nominalGbp: { units: BigInt(0), known: 0, missing: 0 }, confirmedGbp: { units: BigInt(0), known: 0, missing: 0 }, chargeGbp: { units: BigInt(0), known: 0, missing: 0 },
    }
    const resolved = settings.resolve(project.id)
    const fees = dailyHostingFees(project.id, resolved.rates, resolved.schedule, { from: input.from, to: input.to, asOf: today, today })
    return { ...usage, name: project.name, slug: project.slug, hostingDays: fees.length, hostingPence: fees.reduce((sum, fee) => sum + fee.amountPence, 0) }
  })
  return {
    from: input.from,
    to: input.to,
    fxUnavailable: fx.unavailable,
    projects: rows,
    totals: {
      events: rows.reduce((sum, project) => sum + project.events, 0),
      held: rows.reduce((sum, project) => sum + project.held, 0),
      nominal: mergeMoney(rows.map(project => project.nominal)),
      confirmed: mergeMoney(rows.map(project => project.confirmed)),
      charge: mergeMoney(rows.map(project => project.charge)),
      nominalGbp: combineGbp(rows.map(project => project.nominalGbp)),
      confirmedGbp: combineGbp(rows.map(project => project.confirmedGbp)),
      chargeGbp: combineGbp(rows.map(project => project.chargeGbp)),
      hostingDays: rows.reduce((sum, project) => sum + project.hostingDays, 0),
      hostingPence: rows.reduce((sum, project) => sum + project.hostingPence, 0),
    },
  }
}
