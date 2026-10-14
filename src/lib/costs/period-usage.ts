import type { MoneyTotal } from './figures'

export const MAX_INCLUSIVE_PERIOD_DAYS = 800
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

export type InclusivePeriod = { from: string; to: string; start: Date; endExclusive: Date }

export function utcDay(iso: string): Date | null {
  if (!DATE.test(iso)) return null
  const date = new Date(`${iso}T00:00:00.000Z`)
  return date.toISOString().slice(0, 10) === iso ? date : null
}

/** Inclusive UTC dates. Missing dates use the month containing `today`, from the 1st through today. */
export function parseInclusivePeriod(from: string | undefined, to: string | undefined, today: string): { ok: true; period: InclusivePeriod } | { ok: false; error: string } {
  const fallback = !from && !to
  const startText = fallback ? `${today.slice(0, 8)}01` : from
  const endText = fallback ? today : to
  if (!startText || !endText) return { ok: false, error: 'Choose both a start date and an end date.' }
  const start = utcDay(startText)
  const end = utcDay(endText)
  const todayDate = utcDay(today)
  if (!start || !end || !todayDate) return { ok: false, error: 'Dates must be real calendar days.' }
  if (start > end) return { ok: false, error: 'The start date must be on or before the end date.' }
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1
  if (days > MAX_INCLUSIVE_PERIOD_DAYS) return { ok: false, error: `Choose a period of ${MAX_INCLUSIVE_PERIOD_DAYS} days or fewer.` }
  return { ok: true, period: { from: startText, to: endText, start, endExclusive: new Date(end.getTime() + DAY_MS) } }
}

export type GbpCoverage = { units: bigint; known: number; missing: number }
export type AmountSlice = { units: bigint | null; gbp: bigint | null }
export type PeriodEventMeasure = {
  projectId: string
  currency: string
  nominal: AmountSlice | null
  confirmed: AmountSlice | null
  charge: AmountSlice | null
}

export type PeriodProjectTotal = {
  projectId: string
  events: number
  held: number
  nominal: MoneyTotal[]
  confirmed: MoneyTotal[]
  charge: MoneyTotal[]
  nominalGbp: GbpCoverage
  confirmedGbp: GbpCoverage
  chargeGbp: GbpCoverage
}

const emptyGbp = (): GbpCoverage => ({ units: BigInt(0), known: 0, missing: 0 })

function addNative(list: MoneyTotal[], currency: string, units: bigint | null) {
  const current = list.find(item => item.currency === currency) ?? { currency, units: BigInt(0), rows: 0, missing: 0 }
  if (!list.includes(current)) list.push(current)
  if (units === null) current.missing += 1
  else { current.units += units; current.rows += 1 }
}

function addGbp(bucket: GbpCoverage, units: bigint | null, gbp: bigint | null) {
  if (units === null || gbp === null) bucket.missing += 1
  else { bucket.units += gbp; bucket.known += 1 }
}

export function summarisePeriodUsage(rows: PeriodEventMeasure[]): Map<string, PeriodProjectTotal> {
  const projects = new Map<string, PeriodProjectTotal>()
  for (const row of rows) {
    const project = projects.get(row.projectId) ?? {
      projectId: row.projectId, events: 0, held: 0, nominal: [], confirmed: [], charge: [],
      nominalGbp: emptyGbp(), confirmedGbp: emptyGbp(), chargeGbp: emptyGbp(),
    }
    projects.set(row.projectId, project)
    project.events += 1
    if (row.nominal) {
      addNative(project.nominal, row.currency, row.nominal.units)
      addGbp(project.nominalGbp, row.nominal.units, row.nominal.gbp)
    }
    if (row.confirmed) {
      addNative(project.confirmed, row.currency, row.confirmed.units)
      addGbp(project.confirmedGbp, row.confirmed.units, row.confirmed.gbp)
    }
    if (row.charge) {
      addNative(project.charge, row.currency, row.charge.units)
      addGbp(project.chargeGbp, row.charge.units, row.charge.gbp)
    } else project.held += 1
  }
  return projects
}

export function mergeMoney(lists: MoneyTotal[][]): MoneyTotal[] {
  const totals = new Map<string, MoneyTotal>()
  for (const list of lists) for (const item of list) {
    const current = totals.get(item.currency) ?? { currency: item.currency, units: BigInt(0), rows: 0, missing: 0 }
    current.units += item.units
    current.rows += item.rows
    current.missing += item.missing
    totals.set(item.currency, current)
  }
  return Array.from(totals.values()).sort((a, b) => a.currency.localeCompare(b.currency))
}

export function combineGbp(buckets: GbpCoverage[]): GbpCoverage {
  return buckets.reduce((total, bucket) => ({
    units: total.units + bucket.units,
    known: total.known + bucket.known,
    missing: total.missing + bucket.missing,
  }), emptyGbp())
}
