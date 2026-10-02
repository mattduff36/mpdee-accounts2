import { createHash } from 'node:crypto'
import { coverageEnd, coversDate, nextUtcDate, parseUtcDate, type RateRange } from './project-matrix'

export type MembershipSource = {
  id: string
  sourceBucket: string
  periodStart: Date
  periodEnd: Date
  frozenGbpPence: number
  sourceRevision: number
}

const bucketDate = (bucket: string) => bucket.match(/^vercel:membership:(\d{4}-\d{2}-\d{2})$/)?.[1] ?? null

/** UTC instant of midnight in Europe/London for a calendar date. */
export function londonMidnightUtc(isoDate: string) {
  const guess = parseUtcDate(isoDate)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess).map(part => [part.type, part.value]))
  const hour = parts.hour === '24' ? 0 : Number(parts.hour)
  const zonedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second))
  return new Date(guess.getTime() - (zonedAsUtc - guess.getTime()))
}
export function londonDayPeriod(isoDate: string) {
  const start = londonMidnightUtc(isoDate)
  const end = londonMidnightUtc(nextUtcDate(isoDate))
  return { periodStart: start, periodEnd: end }
}
export function membershipChecksum(input: { sourceBucket: string; frozenGbpPence: number; periodStart: Date; periodEnd: Date }) {
  return createHash('sha256').update(JSON.stringify({ sourceBucket: input.sourceBucket, frozenGbpPence: input.frozenGbpPence, periodStart: input.periodStart.toISOString(), periodEnd: input.periodEnd.toISOString() })).digest('hex')
}
/** Inclusive UTC dates for a saved range, closed by the next range and never past today. */
export function membershipDates(range: RateRange, peers: RateRange[], today: string) {
  const end = coverageEnd(range, peers)
  const last = end && end.toISOString().slice(0, 10) < today ? end.toISOString().slice(0, 10) : today
  const start = range.effectiveAt.toISOString().slice(0, 10)
  if (last < start) return []
  const dates: string[] = []
  for (let day = start; day <= last; day = nextUtcDate(day)) dates.push(day)
  return dates
}
export type DailyRate = RateRange & { vercelDailyPence: number }
/** The latest same-scope rate that still covers a day, after a deleted rate has been removed. */
export function coveringDailyRate<T extends DailyRate>(policies: T[], date: Date): T | null {
  return policies.filter(policy => coversDate(policy, policies, date)).sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime())[0] ?? null
}
/** Project rate first, then the client rate, otherwise no daily charge. */
export function dailyPenceAfterRemoval(date: string, projectPolicies: DailyRate[], clientPolicies: DailyRate[]) {
  const day = parseUtcDate(date)
  return coveringDailyRate(projectPolicies, day)?.vercelDailyPence ?? coveringDailyRate(clientPolicies, day)?.vercelDailyPence ?? 0
}
export function planMembershipRewrite(existing: MembershipSource[], dates: string[], pence: number) {
  const byDate = new Map(existing.flatMap(row => { const date = bucketDate(row.sourceBucket); return date ? [[date, row] as const] : [] }))
  const updates: { id: string; frozenGbpPence: number; sourceRevision: number; sourceChecksum: string }[] = []
  const inserts: { sourceBucket: string; periodStart: Date; periodEnd: Date; frozenGbpPence: number; sourceChecksum: string }[] = []
  for (const date of dates) {
    const row = byDate.get(date)
    if (row) {
      if (row.frozenGbpPence === pence) continue
      updates.push({ id: row.id, frozenGbpPence: pence, sourceRevision: row.sourceRevision + 1, sourceChecksum: membershipChecksum({ ...row, frozenGbpPence: pence }) })
    } else if (pence !== 0) {
      const period = londonDayPeriod(date)
      const sourceBucket = `vercel:membership:${date}`
      inserts.push({ sourceBucket, ...period, frozenGbpPence: pence, sourceChecksum: membershipChecksum({ sourceBucket, frozenGbpPence: pence, ...period }) })
    }
  }
  return { updates, inserts }
}
