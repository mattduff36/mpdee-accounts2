import { prisma } from '@/lib/db'
import { unstable_cache } from 'next/cache'
import { ECB_SOURCE, parseEcbRates, quoteFor, type FxQuote, referenceYears } from './fx-values'
export { convertUnits, formatGbpUnits, quoteFor } from './fx-values'
export type { FxQuote } from './fx-values'

export const fetchReferenceRates = unstable_cache(async (year: string): Promise<FxQuote[]> => {
  // Cache the small, parsed year, not the 10MB historical XML (Next's limit is 2MB).
  const response = await fetch(ECB_SOURCE,{cache:'no-store',signal:AbortSignal.timeout(15000)})
  if (!response.ok) throw new Error('Reference rates unavailable')
  const xml = await response.text()
  if (xml.length > 12000000) throw new Error('Unexpected exchange-rate response')
  const earliest=`${Number(year)-1}-12-24`,latest=`${year}-12-31`
  const quotes = parseEcbRates(xml).filter(q=>q.date>=earliest&&q.date<=latest)
  if (!quotes.length) throw new Error('No valid reference rates')
  return quotes
},['costs-ecb-gbp-year-v1'],{revalidate:21600})

type FxRow = { event: { occurredAt: Date }; revision?: { currency: string; fxGbp: {toString():string} | null } | null }
export async function ledgerFx(rows: FxRow[]) {
  const dates = rows.map(r=>r.event.occurredAt.toISOString().slice(0,10)).sort()
  const stored = dates.length ? await prisma.costFxRate.findMany({where:{date:{gte:new Date(Date.parse(dates[0])-7*86400000),lte:new Date(dates[dates.length-1])}}}) : []
  const quotes: FxQuote[] = stored.map(q=>({currency:q.currency,date:q.date.toISOString().slice(0,10),rate:q.gbpRate.toString(),source:q.source}))
  const memo=new Map<string,FxQuote|null>()
  const resolve=(currency:string,date:string)=>{
    const key=`${currency}:${date}`
    if(!memo.has(key)) memo.set(key,quoteFor(quotes,currency,date))
    return memo.get(key)??null
  }
  let unavailable = false
  const missingYears = referenceYears(rows.filter(r => r.revision && !r.revision.fxGbp && !resolve(r.revision.currency, r.event.occurredAt.toISOString().slice(0,10))).map(r => r.event.occurredAt))
  // Each requested year is cached separately; a failed year never discards successful years.
  for (const year of missingYears) {
    try { quotes.push(...await fetchReferenceRates(year)); memo.clear() } catch { unavailable = true }
  }
  const resolved = rows.map(row=>{
    const date=row.event.occurredAt.toISOString().slice(0,10), revision=row.revision
    if (!revision) return null
    if (revision.currency==='GBP') return quoteFor([], 'GBP',date)
    if (revision.fxGbp && Number(revision.fxGbp.toString())>0) return {currency:revision.currency,date,rate:revision.fxGbp.toString(),source:'Rate recorded with usage import'}
    return resolve(revision.currency,date)
  })
  return {quotes:resolved,unavailable}
}
