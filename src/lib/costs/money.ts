export const UNIT = BigInt(10_000_000)
export function roundRatio(value: bigint, denominator: bigint): bigint {
  const sign = value < BigInt(0) ? -BigInt(1) : BigInt(1)
  const absolute = value < BigInt(0) ? -value : value
  return sign * ((absolute + denominator / BigInt(2)) / denominator)
}
export function decimalUnits(value: unknown, scale = 7): bigint {
  const text = typeof value === 'number' && Number.isFinite(value) ? value.toFixed(scale + 1) : String(value)
  if (!/^-?\d+(\.\d+)?$/.test(text) || text.length > 60) throw new Error('Invalid monetary amount')
  const negative = text.startsWith('-')
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.')
  const digits = (fraction + '0'.repeat(scale + 1)).slice(0, scale + 1)
  return roundRatio((BigInt(whole) * BigInt('1' + '0'.repeat(scale + 1)) + BigInt(digits)) * (negative ? -BigInt(1) : BigInt(1)), BigInt(10))
}
export function unitsText(value: bigint): string {
  const negative = value < BigInt(0)
  const n = negative ? -value : value
  return `${negative ? '-' : ''}${n / UNIT}.${String(n % UNIT).padStart(7, '0')}`
}
export function gbpPence(value: bigint, fx: string): bigint {
  return roundRatio(value * decimalUnits(fx, 8) * BigInt(100), UNIT * BigInt(100_000_000))
}
export type Policy = { billable: boolean; includedBaseBps: number; markupBps: number; infrastructureMarkupBps: number }
export function chargeUnits(input: { provider: string; funding: string; nominal: bigint | null; cash: bigint | null }, policy: Policy): bigint | null {
  if (!policy.billable) return BigInt(0)
  if (input.funding === 'free') return BigInt(0)
  const base = input.provider === 'cursor' && input.funding === 'included' ? input.nominal : input.cash
  if (base === null || input.funding === 'unknown') return null
  const bps = input.provider === 'cursor'
    ? (input.funding === 'included' ? policy.includedBaseBps : 10000) + policy.markupBps
    : 10000 + policy.infrastructureMarkupBps
  return roundRatio(base * BigInt(bps), BigInt(10000))
}
export function percentBps(text: string): number {
  const amount = decimalUnits(text, 2)
  if (amount < BigInt(0) || amount > BigInt(100000)) throw new Error('Percentage must be between 0 and 1000')
  return Number(amount)
}
