export type Period = { periodStart: Date; periodEnd: Date }
export type CostInvoice = Period & { id: string; projectId: string; netPence: number; weightPence?: number }
export type Allocation = Period & { id: string; projectId: string; amountPence: number; kind: string }
export const DAY = 86400000
export const dayNumber = (date: Date) => Math.floor(date.getTime() / DAY)

/** Largest remainder, stable IDs, signed refunds; sum(output) always equals amount. */
export function splitPence(amount: number, weights: { id: string; weight: bigint }[]): Map<string, number> {
  const rows = weights.filter(x => x.weight > BigInt(0)).sort((a, b) => a.id.localeCompare(b.id))
  const result = new Map<string, number>()
  const total = rows.reduce((n, x) => n + x.weight, BigInt(0))
  if (!total) return result
  const absolute = BigInt(Math.abs(amount)), sign = amount < 0 ? -1 : 1
  const parts = rows.map(x => ({ ...x, pence: absolute * x.weight / total, remainder: absolute * x.weight % total }))
  let remaining = absolute - parts.reduce((n, x) => n + x.pence, BigInt(0))
  for (const part of [...parts].sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1)) {
    if (remaining > BigInt(0)) { part.pence++; remaining-- }
  }
  for (const part of parts) result.set(part.id, Number(part.pence) * sign)
  return result
}

/** Spread each real expense share across its service days; overlapping invoices share a day by net invoice value. */
export function invoiceCosts(invoices: CostInvoice[], allocations: Allocation[]) {
  const costs = new Map(invoices.map(i => [i.id, { direct: 0, subscription: 0 }]))
  let unmatchedPence = 0
  for (const allocation of allocations) {
    const start = dayNumber(allocation.periodStart), end = dayNumber(allocation.periodEnd)
    if (end < start || end - start > 3660) throw new Error('Service period must be valid and no more than ten years.')
    const days = splitPence(allocation.amountPence, Array.from({ length: end - start + 1 }, (_, i) => ({ id: String(start + i), weight: BigInt(1) })))
    const candidates = invoices.filter(i => i.projectId === allocation.projectId && (i.weightPence ?? i.netPence) > 0 && dayNumber(i.periodStart) <= end && dayNumber(i.periodEnd) >= start)
    for (const [dayText, amount] of Array.from(days)) {
      const day = Number(dayText)
      const matches = candidates.filter(i => dayNumber(i.periodStart) <= day && dayNumber(i.periodEnd) >= day)
      if (!matches.length) { unmatchedPence += amount; continue }
      for (const [id, value] of Array.from(splitPence(amount, matches.map(i => ({ id: i.id, weight: BigInt(i.weightPence ?? i.netPence) }))))) {
        const target = costs.get(id)!
        if (allocation.kind === 'subscription') target.subscription += value
        else target.direct += value
      }
    }
  }
  return { costs, unmatchedPence }
}

export function validAllocation(expensePence: number, requestedPence: number, otherPence: number) {
  return Number.isSafeInteger(expensePence) && Number.isSafeInteger(otherPence) && Number.isSafeInteger(requestedPence) && Math.abs(requestedPence) <= 2147483647 &&
    Math.abs(requestedPence) <= Math.abs(expensePence) && Math.abs(otherPence) <= Math.abs(expensePence) &&
    (otherPence === 0 || Math.sign(otherPence) === Math.sign(expensePence)) &&
    (requestedPence === 0 || Math.sign(requestedPence) === Math.sign(expensePence)) &&
    Math.abs(otherPence + requestedPence) <= Math.abs(expensePence)
}

export function parsePeriod(start: string, end: string): Period {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose both service dates.')
    const date = new Date(`${value}T00:00:00Z`)
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Choose valid service dates.')
    return date
  }
  const periodStart = parse(start), periodEnd = parse(end)
  if (periodEnd < periodStart || dayNumber(periodEnd) - dayNumber(periodStart) > 3660) throw new Error('End must follow start, within ten years.')
  return { periodStart, periodEnd }
}
