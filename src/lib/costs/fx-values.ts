import { decimalUnits, roundRatio, UNIT } from './money'

export type FxQuote = { currency: string; date: string; rate: string; source: string }
export const ECB_SOURCE = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml'
export function parseEcbRates(xml: string): FxQuote[] {
  const quotes: FxQuote[] = []
  for (const day of Array.from(xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]>([\s\S]*?)<\/Cube>/g))) {
    const currencies = new Map(Array.from(day[2].matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]\s*\/>/g), m => [m[1],m[2]]))
    const gbp = currencies.get('GBP')
    if (!gbp || gbp.length > 60 || !/^[0-9]+(\.[0-9]+)?$/.test(gbp)) continue
    currencies.set('EUR','1')
    for (const currency of ['USD','EUR','GBP']) {
      const native = currencies.get(currency)
      if (!native || !/^[0-9]+(\.[0-9]+)?$/.test(native) || native.length > 60) continue
      const denominator = decimalUnits(native,8)
      if (denominator <= BigInt(0)) continue
      const scaled = roundRatio(decimalUnits(gbp,8)*BigInt(100000000),denominator)
      if (scaled <= BigInt(0)) continue
      quotes.push({ currency,date:day[1],rate:`${scaled / BigInt(100000000)}.${String(scaled % BigInt(100000000)).padStart(8,'0')}`,source:ECB_SOURCE })
    }
  }
  return quotes
}

// Use the latest published working-day quote on/before usage, never a future rate.
export function quoteFor(quotes: FxQuote[], currency: string, date: string): FxQuote | null {
  if (currency === 'GBP') return {currency,date,rate:'1',source:'GBP original amount'}
  const day = Date.parse(`${date}T00:00:00Z`)
  return quotes.filter(q => q.currency === currency && q.date <= date && day-Date.parse(`${q.date}T00:00:00Z`) <= 7*86400000)
    .sort((a,b)=>b.date.localeCompare(a.date))[0] ?? null
}
export function convertUnits(units: bigint | null, quote: FxQuote | null): bigint | null {
  if (units === null) return null
  if (units === BigInt(0)) return BigInt(0)
  if (!quote || decimalUnits(quote.rate,8) <= BigInt(0)) return null
  return roundRatio(units*decimalUnits(quote.rate,8),BigInt(100000000))
}
export function formatGbpUnits(units: bigint | null): string {
  if (units === null) return 'Unavailable'
  const pence = roundRatio(units*BigInt(100),UNIT)
  return new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(Number(pence)/100)
}

// Resolve each historical year independently, including its preceding working-day buffer.
export function referenceYears(dates: Date[]): string[] {
  return Array.from(new Set(dates.map(date => date.getUTCFullYear().toString()))).sort()
}
