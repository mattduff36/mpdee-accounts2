import {
  assertHostingPence,
  assertHostingSchedule,
  assertRateBps,
  parseIsoDate,
  type CalculationRates,
  type HostingSchedule,
} from './calculation-settings'

export const MAX_DAILY_HOSTING_SPAN_DAYS = 3660
export const DAILY_HOSTING_LABEL = 'Daily hosting fee'

export type DailyHostingWindow = {
  from: string
  to?: string
  asOf?: string
  today: string
}

export type DailyHostingFee = {
  id: string
  projectId: string
  date: string
  amountPence: number
  currency: 'GBP'
  category: 'VERCEL_HOSTING'
  funding: 'infrastructure'
  label: typeof DAILY_HOSTING_LABEL
  configRevision: string
  providerCash: false
}

const DAY_MS = 86_400_000

export function dailyHostingFeeId(projectId: string, date: string): string {
  return `internal:daily-hosting:${projectId}:${date}`
}

export function hostingConfigRevision(projectId: string, dailyHostingPence: number, schedule: HostingSchedule): string {
  return `hosting:${projectId}:${dailyHostingPence}:${schedule.hostingEnabled ? 1 : 0}:${schedule.hostingStartDate ?? ''}:${schedule.hostingEndDate ?? ''}`
}

function utcDay(iso: string): number {
  return Date.parse(`${parseIsoDate(iso)}T00:00:00.000Z`)
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function optionalDay(value: string | undefined, field: string): string | null {
  if (value === undefined) return null
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`)
  return parseIsoDate(value)
}

export function dailyHostingFees(projectId: string, rates: CalculationRates, schedule: HostingSchedule, window: DailyHostingWindow): DailyHostingFee[] {
  if (typeof projectId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(projectId)) throw new Error('Invalid project')
  const amountPence = assertHostingPence(rates.dailyHostingPence)
  assertRateBps(rates.includedPremiumBps)
  assertRateBps(rates.includedGrokComposerBps)
  assertRateBps(rates.onDemandBps)
  assertHostingSchedule(schedule)
  const from = parseIsoDate(window.from)
  const today = parseIsoDate(window.today)
  const to = optionalDay(window.to, 'report end')
  const asOf = optionalDay(window.asOf, 'as-of date')
  if (to !== null && to < from) throw new Error('Reversed report window')
  if (!schedule.hostingEnabled || amountPence === 0) return []
  const start = schedule.hostingStartDate
  if (start === null) throw new Error('Hosting enabled requires a start date')
  let rangeStart = start > from ? start : from
  let rangeEnd = today
  if (schedule.hostingEndDate !== null && schedule.hostingEndDate < rangeEnd) rangeEnd = schedule.hostingEndDate
  if (asOf !== null && asOf < rangeEnd) rangeEnd = asOf
  if (to !== null && to < rangeEnd) rangeEnd = to
  if (rangeStart > rangeEnd) return []
  const span = Math.round((utcDay(rangeEnd) - utcDay(rangeStart)) / DAY_MS) + 1
  if (!Number.isSafeInteger(span) || span < 1 || span > MAX_DAILY_HOSTING_SPAN_DAYS) throw new Error('Hosting fee span exceeds cap')
  if (span > Math.floor(Number.MAX_SAFE_INTEGER / amountPence)) throw new Error('Hosting fee total is not a safe integer')
  const configRevision = hostingConfigRevision(projectId, amountPence, schedule)
  const fees: DailyHostingFee[] = []
  const startMs = utcDay(rangeStart)
  for (let index = 0; index < span; index += 1) {
    const date = isoDay(startMs + index * DAY_MS)
    if (date > today) throw new Error('Hosting fee span exceeds cap')
    fees.push({
      id: dailyHostingFeeId(projectId, date),
      projectId,
      date,
      amountPence,
      currency: 'GBP',
      category: 'VERCEL_HOSTING',
      funding: 'infrastructure',
      label: DAILY_HOSTING_LABEL,
      configRevision,
      providerCash: false,
    })
  }
  return fees
}
