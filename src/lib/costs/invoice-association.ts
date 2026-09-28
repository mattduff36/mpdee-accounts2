type Suggestion = { start: string; end: string; evidence: string }
const months = ['january','february','march','april','may','june','july','august','september','october','november','december']
const monthPattern = months.join('|')
function validDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value
}
/** Conservative suggestions only. Every recognised date must identify the same period; user confirmation is still required. */
export function suggestInvoicePeriod(text: string): Suggestion | null {
  const source = text.toLowerCase()
  const candidates: { value: Suggestion; from: number; to: number }[] = []
  const add = (start: string, end: string, from: number, to: number) => {
    if (!validDate(start) || !validDate(end) || end < start) return false
    candidates.push({ value: { start, end, evidence: text.slice(from,to) }, from, to })
    return true
  }
  for (const match of Array.from(source.matchAll(/\b(20\d{2}-\d{2}-\d{2})(?:\s*(?:to|[-–—])\s*(20\d{2}-\d{2}-\d{2}))?\b/g))) {
    if (!add(match[1],match[2]||match[1],match.index!,match.index!+match[0].length)) return null
  }
  for (const match of Array.from(source.matchAll(new RegExp(`\\b(${monthPattern})\\s+(20\\d{2})\\b`,'g')))) {
    const at=match.index!, month=months.indexOf(match[1]), year=Number(match[2])
    const prefix=source.slice(0,at)
    // Parse the day(s) before considering a whole-month suggestion.
    const days=prefix.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:(?:[-–—]|to)\s*(\d{1,2})(?:st|nd|rd|th)?\s*)?$/)
    const from=days?at-days[0].length:at
    const before=source.slice(0,from)
    // An unsupported range (e.g. 1 August–9 September) or open-ended period must not become a single day/month.
    if (/(?:\b(?:from|until|before|after|since|to)|\d\s*[-–—/,])\s*$/.test(before)) return null
    if (!days && /\d\s*$/.test(prefix)) return null
    const iso=(day:number)=>`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
    const start=iso(days?Number(days[1]):1)
    const end=iso(days?Number(days[2]||days[1]):new Date(Date.UTC(year,month+1,0)).getUTCDate())
    if (!add(start,end,from,at+match[0].length)) return null
  }
  if (!candidates.length) return null
  let remaining=source
  for (const candidate of [...candidates].sort((a,b)=>b.from-a.from)) remaining=remaining.slice(0,candidate.from)+' '.repeat(candidate.to-candidate.from)+remaining.slice(candidate.to)
  // Other month/date evidence makes the description mixed or unsupported, even if one part parsed cleanly.
  if (new RegExp(`\\b(${monthPattern})\\b`).test(remaining) || /\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b/.test(remaining)) return null
  const unique=new Map(candidates.map(c=>[`${c.value.start}/${c.value.end}`,c.value]))
  return unique.size===1?Array.from(unique.values())[0]:null
}
