import { assertHostingPence, assertRateBps, DEFAULT_CALCULATION_RATES, type CalculationRates } from './calculation-settings'

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
export type Policy = {
  billable: boolean
  includedBaseBps: number
  markupBps: number
  infrastructureMarkupBps: number
  rates?: CalculationRates
}

/** Corrected universal client charge. Legacy percentage fields stay typed and are not applied. Absent rates keep the previous defaults. */
export const CHARGE_RULE_VERSION = 'mpdee-global-client-charge-v2'

/** Exact Grok/Composer family names and their Cursor-prefixed or versioned aliases. */
export function isGrokOrComposerFamily(model: string): boolean {
  return /^(?:cursor-)?(?:grok|composer)(?:-.+)?$/i.test(model.trim())
}

function resolvedRates(policy: Policy): CalculationRates {
  if (!policy.rates) return DEFAULT_CALCULATION_RATES
  return {
    includedPremiumBps: assertRateBps(policy.rates.includedPremiumBps),
    includedGrokComposerBps: assertRateBps(policy.rates.includedGrokComposerBps),
    onDemandBps: assertRateBps(policy.rates.onDemandBps),
    dailyHostingPence: assertHostingPence(policy.rates.dailyHostingPence),
  }
}

export function chargeUnits(input: { provider: string; funding: string; nominal: bigint | null; cash: bigint | null; model?: string | null }, policy: Policy): bigint | null {
  if (!policy.billable) return BigInt(0)
  if (input.funding === 'free' || input.funding === 'free-credit') return BigInt(0)
  if (input.funding === 'unknown') return null
  const rates = resolvedRates(policy)
  if (input.provider === 'cursor' && input.funding === 'included') {
    const model = typeof input.model === 'string' ? input.model.trim() : ''
    if (input.nominal === null || model === '' || /^(?:default|auto|unknown|unspecified)$/i.test(model)) return null
    const bps = isGrokOrComposerFamily(model) ? rates.includedGrokComposerBps : rates.includedPremiumBps
    return roundRatio(input.nominal * BigInt(bps), BigInt(10000))
  }
  if (input.funding === 'on-demand') {
    if (input.cash === null) return null
    return roundRatio(input.cash * BigInt(rates.onDemandBps), BigInt(10000))
  }
  if (input.cash === null) return null
  return input.cash
}
export function percentBps(text: string): number {
  const amount = decimalUnits(text, 2)
  if (amount < BigInt(0) || amount > BigInt(100000)) throw new Error('Percentage must be between 0 and 1000')
  return Number(amount)
}
