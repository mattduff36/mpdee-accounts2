import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { developmentMetadata } from './normalize'
import { decimalUnits, roundRatio, unitsText } from './money'
import { DEVELOPMENT_PROVIDERS, isDevelopmentProvider } from './providers'

export const DEVELOPMENT_EVENT_LIMIT = 50_000
const DAY = 86_400_000
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'Invalid ISO calendar day')
const querySchema = z.object({
  from: day,
  to: day,
  projectId: z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  groupBy: z.enum(['day', 'week', 'month']).default('week'),
}).strict().superRefine((value, context) => {
  const days = (Date.parse(value.to) - Date.parse(value.from)) / DAY
  if (days <= 0 || days > 366) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Use an exclusive end date after from, at most 366 days apart' })
})
export type DevelopmentQuery = z.infer<typeof querySchema>

export class DevelopmentReportError extends Error {
  constructor(message: string, public status: 400 | 422 = 400) { super(message); this.name = 'DevelopmentReportError' }
}

export function parseDevelopmentQuery(input: Record<string, unknown>, now = new Date()): DevelopmentQuery {
  const tomorrow = new Date(Date.parse(developmentPeriod(now, 'day')) + DAY)
  const parsed = querySchema.safeParse({
    ...input,
    projectId: input.projectId === '' ? undefined : input.projectId,
    from: input.from ?? new Date(tomorrow.getTime() - 30 * DAY).toISOString().slice(0, 10),
    to: input.to ?? tomorrow.toISOString().slice(0, 10),
  })
  if (!parsed.success) throw new DevelopmentReportError(parsed.error.issues.map(issue => issue.message).join('; '))
  return parsed.data
}

export type DevelopmentEvent = {
  id: string
  provider: string
  accountRef: string
  sourceKey: string
  projectId: string | null
  project?: { name: string } | null
  occurredAt: Date
  revisions: {
    revision: number
    nominalUnits: bigint | null
    providerUnits: bigint | null
    currency: string
    fxGbp: { toString(): string } | null
    funding: string
    evidence: unknown
  }[]
}

export function developmentEventQuery(query: DevelopmentQuery) {
  return {
    where: {
      provider: { in: [...DEVELOPMENT_PROVIDERS] },
      occurredAt: { gte: londonMidnight(query.from), lt: londonMidnight(query.to) },
      ...(query.projectId ? { projectId: query.projectId === 'unassigned' ? null : query.projectId } : {}),
    },
    select: {
      id: true, provider: true, accountRef: true, sourceKey: true, projectId: true, occurredAt: true,
      project: { select: { name: true } },
      revisions: { orderBy: { revision: 'desc' }, take: 1, select: {
        revision: true, nominalUnits: true, providerUnits: true, currency: true, fxGbp: true, funding: true, evidence: true,
      } },
    },
    orderBy: { id: 'asc' },
    take: DEVELOPMENT_EVENT_LIMIT + 1,
  } satisfies Prisma.CostUsageEventFindManyArgs
}

type Money = { units: bigint; known: number; unknown: number }
const money = (): Money => ({ units: BigInt(0), known: 0, unknown: 0 })
function add(target: Money, value: bigint | null) {
  if (value === null) target.unknown++
  else { target.units += value; target.known++ }
}
function present(value: Money) {
  return {
    amount: value.unknown || !value.known ? null : unitsText(value.units),
    knownAmount: value.known ? unitsText(value.units) : null,
    known: value.known, unknown: value.unknown,
  }
}
export type DevelopmentAmount = ReturnType<typeof present>
type Bucket = {
  provider: string; currency: string; projectId: string | null; period: string | null
  records: number
  projectName: string | null
  observedFrom: string; observedThrough: string
  coverage: Record<'complete' | 'partial' | 'unknown', number>
  funding: Record<'paid' | 'grant' | 'subscription' | 'unknown', number>
  nominal: Money; cash: Money; nominalGbp: Money; cashGbp: Money
}
const londonDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
/** London midnight is unambiguous, including both UK clock-change dates. */
export function londonMidnight(day: string) {
  const utc = new Date(`${day}T00:00:00.000Z`)
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(utc)
  const hours = Number(parts.find(p => p.type === 'hour')!.value)
  const minutes = Number(parts.find(p => p.type === 'minute')!.value)
  return new Date(utc.getTime() - (hours * 60 + minutes) * 60_000)
}
export function developmentPeriod(date: Date, groupBy: DevelopmentQuery['groupBy']) {
  const parts = londonDay.formatToParts(date)
  const part = (type: string) => parts.find(item => item.type === type)!.value
  const local = `${part('year')}-${part('month')}-${part('day')}`
  if (groupBy === 'month') return local.slice(0, 7)
  if (groupBy === 'day') return local
  const monday = new Date(`${local}T00:00:00.000Z`)
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
  return monday.toISOString().slice(0, 10)
}

function metadata(evidence: unknown) {
  const value = evidence && typeof evidence === 'object' && !Array.isArray(evidence) && 'development' in evidence ? evidence.development : undefined
  const parsed = developmentMetadata.safeParse(value)
  if (!parsed.success || !parsed.data) throw new DevelopmentReportError('Development evidence has missing or invalid metadata; correct the source import before reporting', 422)
  return parsed.data
}

/** No combined development total: provider evidence and task measurements can overlap. */
export function buildDevelopmentReport(events: DevelopmentEvent[], query: DevelopmentQuery) {
  if (events.length > DEVELOPMENT_EVENT_LIMIT) throw new DevelopmentReportError('Development report exceeds 50000 events; shorten the period or filter by project', 422)
  const unique = new Map<string, DevelopmentEvent>()
  const start = londonMidnight(query.from).getTime(), end = londonMidnight(query.to).getTime()
  for (const event of events) {
    if (!isDevelopmentProvider(event.provider) || event.occurredAt.getTime() < start || event.occurredAt.getTime() >= end) continue
    if (query.projectId && event.projectId !== (query.projectId === 'unassigned' ? null : query.projectId)) continue
    const key = JSON.stringify([event.provider, event.accountRef, event.sourceKey])
    const previous = unique.get(key)
    const latest = (row: DevelopmentEvent) => Math.max(0, ...row.revisions.map(revision => revision.revision))
    if (!previous || latest(event) > latest(previous)) unique.set(key, event)
  }
  const daily = { totals: new Map<string, Bucket>(), groups: new Map<string, Bucket>() }
  const tasks = { totals: new Map<string, Bucket>(), groups: new Map<string, Bucket>() }
  for (const event of unique.values()) {
    const revision = [...event.revisions].sort((a, b) => b.revision - a.revision)[0]
    if (!revision) throw new DevelopmentReportError('Development event is missing its monetary revision', 422)
    const meta = metadata(revision.evidence)
    if (!['USD', 'GBP', 'EUR'].includes(revision.currency)) throw new DevelopmentReportError('Unsupported development source currency', 422)
    const rawRate = revision.fxGbp?.toString() ?? null
    if (rawRate !== null && (rawRate.length > 60 || !/^\d+(\.\d+)?(?:e[+-]?\d{1,3})?$/i.test(rawRate))) throw new DevelopmentReportError('Invalid recorded development FX', 422)
    const recordedRate = rawRate === null ? null : new Prisma.Decimal(rawRate)
    if (recordedRate && (recordedRate.lte(0) || recordedRate.gt(100) || recordedRate.decimalPlaces() > 8)) throw new DevelopmentReportError('Invalid recorded development FX', 422)
    const rate = revision.currency === 'GBP' ? '1' : recordedRate?.toFixed(8) ?? null
    const gbp = (value: bigint | null) => value === null || rate === null ? null : roundRatio(value * decimalUnits(rate, 8), BigInt(100_000_000))
    const section = meta.recordClass === 'provider-daily-aggregate' ? daily : tasks
    const period = developmentPeriod(event.occurredAt, query.groupBy)
    for (const [map, projectId, periodKey] of [[section.totals, null, null], [section.groups, event.projectId, period]] as const) {
      const key = JSON.stringify([event.provider, revision.currency, projectId, periodKey])
      const bucket = map.get(key) ?? {
        provider: event.provider, currency: revision.currency, projectId, period: periodKey, records: 0,
        projectName: projectId ? event.project?.name ?? null : null,
        observedFrom: meta.observedAt, observedThrough: meta.observedAt,
        coverage: { complete: 0, partial: 0, unknown: 0 }, funding: { paid: 0, grant: 0, subscription: 0, unknown: 0 },
        nominal: money(), cash: money(), nominalGbp: money(), cashGbp: money(),
      }
      bucket.records++
      if (meta.observedAt < bucket.observedFrom) bucket.observedFrom = meta.observedAt
      if (meta.observedAt > bucket.observedThrough) bucket.observedThrough = meta.observedAt
      bucket.coverage[meta.coverage]++
      bucket.funding[meta.funding]++
      add(bucket.nominal, revision.nominalUnits)
      add(bucket.nominalGbp, gbp(revision.nominalUnits))
      if (meta.recordClass === 'provider-daily-aggregate') {
        add(bucket.cash, revision.providerUnits)
        add(bucket.cashGbp, gbp(revision.providerUnits))
      }
      map.set(key, bucket)
    }
  }
  const rows = <T>(map: Map<string, Bucket>, amounts: (bucket: Bucket) => T) => [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, bucket]) => ({
    provider: bucket.provider, currency: bucket.currency, projectId: bucket.projectId,
    projectName: bucket.projectName, observedFrom: bucket.observedFrom, observedThrough: bucket.observedThrough,
    assignment: bucket.period === null ? 'all' as const : bucket.projectId === null ? 'unassigned' as const : 'assigned' as const,
    period: bucket.period, records: bucket.records, coverage: bucket.coverage, funding: bucket.funding,
    ...amounts(bucket),
  }))
  const estimates = (bucket: Bucket) => ({ estimatedValue: present(bucket.nominal), estimatedGbp: present(bucket.nominalGbp) })
  const reported = (bucket: Bucket) => ({ reportedValue: present(bucket.nominal), reportedGbp: present(bucket.nominalGbp), evidencedCash: present(bucket.cash), evidencedCashGbp: present(bucket.cashGbp) })
  return {
    version: 'mpdee-development-report-v1' as const,
    from: query.from, to: query.to, endExclusive: true, groupBy: query.groupBy,
    dateBoundsTimezone: 'Europe/London', groupingTimezone: 'Europe/London', projectId: query.projectId ?? null,
    records: unique.size,
    warning: 'Non-additive evidence: provider daily aggregates and task estimates may overlap. Task estimates are not actual costs or client charges. Cash and funding require separate evidence. Source coverage counts do not establish complete coverage of the selected period. Provider daily buckets retain their native boundaries; they are not prorated into UK hours.',
    providerDailyAggregates: { totals: rows(daily.totals, reported), groups: rows(daily.groups, reported) },
    taskMeasurements: { totals: rows(tasks.totals, estimates), groups: rows(tasks.groups, estimates) },
  }
}
