import { formatGbpUnits } from '@/lib/costs/fx'
import { panel } from './ui'
import type { aggregateCostReport } from '@/lib/costs/report-aggregation'

type Report = ReturnType<typeof aggregateCostReport>
const colours = ['#1d4ed8', '#0f766e', '#d97706']
const amount = (value: bigint) => Number(value) / 10_000_000

export function CostReportCharts({ daily, composition }: { daily: Report['daily']; composition: Report['composition'] }) {
  let estimateRun = 0, cashRun = 0
  const cumulative = daily.map(d => {
    estimateRun += amount(d.estimate)
    cashRun += amount(d.providerCash)
    return { date: d.date, estimate: d.estimateKnown ? estimateRun : null, cash: d.providerCashKnown ? cashRun : null, partialEstimate: d.estimateKnown < d.events, partialCash: d.providerCashKnown > 0 && d.providerCashKnown < d.events }
  })
  const values = cumulative.flatMap(d => [d.estimate, d.cash]).filter((value): value is number => value !== null)
  const high = Math.max(1, ...values), low = Math.min(0, ...values)
  const spread = Math.max(1, high - low)
  const x = (i: number) => cumulative.length < 2 ? 50 : 50 + i * 700 / (cumulative.length - 1)
  const y = (value: number) => 154 - (value - low) / spread * 130
  const path = (key: 'estimate' | 'cash') => {
    let penDown = false
    return cumulative.flatMap((d, i) => {
      const value = d[key]
      if (value === null) { penDown = false; return [] }
      const command = `${penDown ? 'L' : 'M'}${x(i)},${y(value)}`
      penDown = true
      return [command]
    }).join(' ')
  }
  const totalComposition = composition.reduce((sum, item) => sum + item.value, BigInt(0))
  const compositionMagnitude = composition.reduce((sum, item) => sum + (item.value < BigInt(0) ? -item.value : item.value), BigInt(0))
  const circumference = 2 * Math.PI * 42
  let offset = 0
  const rankedDays = daily.filter(d => d.providerCashKnown > 0 && d.providerCash > BigInt(0)).sort((a, b) => a.providerCash > b.providerCash ? -1 : a.providerCash < b.providerCash ? 1 : a.date.localeCompare(b.date)).slice(0, 5)
  const maxCash = Math.max(1, ...rankedDays.map(d => amount(d.providerCash)))
  const categoryValues = daily.map(d => [d.included, d.onDemand, d.infrastructure])
  const positivePeak = Math.max(0, ...categoryValues.map(values => {
    const total = values.filter(v => v > BigInt(0)).reduce((sum, value) => sum + value, BigInt(0))
    return amount(total)
  }))
  const negativePeak = Math.max(0, ...categoryValues.map(values => {
    const total = values.filter(v => v < BigInt(0)).reduce((sum, value) => sum - value, BigInt(0))
    return amount(total)
  }))
  const chartWidth = Math.max(700, daily.length * 27 + 70)
  const plotLeft = 48, plotRight = chartWidth - 14, spacing = daily.length > 1 ? (plotRight - plotLeft) / daily.length : 24
  const barWidth = Math.max(6, Math.min(16, spacing * 0.62))
  const extent = Math.max(1, positivePeak + negativePeak)
  const unitsPerPixel = 124 / extent
  const baseline = 18 + positivePeak * unitsPerPixel

  return <div className="space-y-5">
    <section className={`${panel} overflow-hidden`}>
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-blue-800">Month to date</p><h2 className="mt-1 font-serif text-2xl font-medium">Estimated charges and provider cash</h2></div><div className="flex flex-wrap gap-x-5 gap-y-2 text-xs"><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-blue-700"/>Client estimate</span><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-teal-700"/>Recorded provider cash</span></div></div>
      <p className="mt-2 text-sm text-slate-600">Cumulative known amounts only. Provider cash excludes subscription fees and included-usage value. Gaps mean no amount was imported; amber markers flag dates where some event amounts are missing. Held estimates are excluded.</p>
      {cumulative.length ? <div className="mt-4 overflow-x-auto"><svg viewBox="0 0 800 190" role="img" aria-label="Cumulative known client estimates compared with available recorded provider cash" className="h-56 min-w-[620px] w-full"><line x1="50" x2="750" y1={y(0)} y2={y(0)} stroke="#cbd5e1"/><line x1="50" x2="50" y1="24" y2="154" stroke="#cbd5e1"/><text x="50" y="178" fill="#64748b" fontSize="11">{cumulative[0].date}</text><text x="750" y="178" textAnchor="end" fill="#64748b" fontSize="11">{cumulative[cumulative.length-1].date}</text><text x="8" y="30" fill="#64748b" fontSize="11">£{Math.round(high).toLocaleString('en-GB')}</text>{low<0&&<text x="8" y="150" fill="#64748b" fontSize="11">£{Math.round(low).toLocaleString('en-GB')}</text>}<path d={path('estimate')} fill="none" stroke="#1d4ed8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/><path d={path('cash')} fill="none" stroke="#0f766e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>{cumulative.length===1&&cumulative[0].estimate!==null&&<circle aria-label="Single-date estimate" cx={x(0)} cy={y(cumulative[0].estimate)} r="3" fill="#1d4ed8"/>}{cumulative.length===1&&cumulative[0].cash!==null&&<circle aria-label="Single-date provider cash" cx={x(0)} cy={y(cumulative[0].cash)} r="3" fill="#0f766e"/>}{cumulative.map((d,i)=><g key={d.date}>{d.partialCash&&d.cash!==null&&<circle aria-label={`${d.date}: some provider cash amounts unavailable`} cx={x(i)} cy={y(d.cash)} r="4" fill="#d97706" stroke="white" strokeWidth="1.5"/>}{d.partialEstimate&&d.estimate!==null&&<circle aria-label={`${d.date}: some estimate amounts held or unavailable`} cx={x(i)} cy={y(d.estimate)} r="4" fill="#d97706" stroke="white" strokeWidth="1.5"/>}</g>)}</svg></div> : <p className="py-10 text-center text-sm text-slate-500">No imported usage in this period.</p>}
    </section>
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <section className={panel}><p className="text-xs font-semibold uppercase tracking-widest text-blue-800">Estimate composition</p><h2 className="mt-1 font-serif text-2xl font-medium">What makes up the charge?</h2><div className="mt-4 flex items-center gap-6">{composition.length && compositionMagnitude > BigInt(0) ? <svg viewBox="0 0 110 110" role="img" aria-label="Composition of estimated client charges" className="h-32 w-32 shrink-0"><circle cx="55" cy="55" r="42" fill="none" stroke="#e2e8f0" strokeWidth="15"/>{composition.map((item, i) => { const magnitude=item.value<BigInt(0)?-item.value:item.value; const length = amount(magnitude) / amount(compositionMagnitude) * circumference; const current = offset; offset += length; return <circle key={item.label} aria-label={`${item.label}: ${formatGbpUnits(item.value)}`} cx="55" cy="55" r="42" fill="none" stroke={colours[i % colours.length]} strokeWidth="15" strokeDasharray={`${length} ${circumference-length}`} strokeDashoffset={-current} transform="rotate(-90 55 55)"/> })}<text x="55" y="53" textAnchor="middle" fill="#0f172a" fontSize="11" fontWeight="600">{formatGbpUnits(totalComposition)}</text><text x="55" y="67" textAnchor="middle" fill="#64748b" fontSize="8">net estimate</text></svg> : <div className="grid h-32 w-32 shrink-0 place-items-center rounded-full border-[14px] border-slate-100 text-xs text-slate-500">No estimates</div>}<ul className="min-w-0 space-y-3">{composition.map((item, i) => <li key={item.label} className="flex items-start gap-2 text-sm"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{backgroundColor:colours[i%colours.length]}}/><span className="min-w-0 flex-1">{item.label}<strong className="block tabular-nums">{formatGbpUnits(item.value)}</strong></span></li>)}</ul></div><p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">Ring segments show category magnitude, so credits still appear; the centre and labels retain signed totals. Nominal included usage informs policy estimates, not provider cash.</p></section>
      <section className={panel}><p className="text-xs font-semibold uppercase tracking-widest text-blue-800">Ranked provider-cash days</p><h2 className="mt-1 font-serif text-2xl font-medium">Dates with highest extra costs</h2><p className="mt-2 text-sm text-slate-600">Net positive imported provider cash by UTC date, after same-day credits.</p>{rankedDays.length ? <ol className="mt-5 space-y-4">{rankedDays.map((d, i) => <li key={d.date}><div className="mb-1 flex justify-between gap-3 text-sm"><span><span className="mr-2 font-mono text-xs text-slate-400">{String(i+1).padStart(2,'0')}</span>{d.date}</span><span className="shrink-0 font-medium tabular-nums">{formatGbpUnits(d.providerCash)}{d.providerCashKnown < d.events ? '*' : ''}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-700" style={{width:`${amount(d.providerCash)/maxCash*100}%`}}/></div></li>)}</ol> : <p className="py-8 text-sm text-slate-500">No date has positive known provider cash in this period.</p>}<p className="mt-4 text-xs leading-5 text-slate-500">Provider cash includes only imported usage charges, not subscription fees. An asterisk means some events on that date have unknown cash amounts.</p></section>
    </div>
    <section className={panel}><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-blue-800">Daily estimate</p><h2 className="mt-1 font-serif text-2xl font-medium">Charges by usage date</h2></div><div className="flex flex-wrap gap-x-4 gap-y-2 text-xs"><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm bg-blue-700"/>Included usage</span><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm bg-teal-700"/>On-demand</span><span className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm bg-amber-500"/>Infrastructure</span></div></div>
      {daily.length ? <div className="mt-4 overflow-x-auto"><svg viewBox={`0 0 ${chartWidth} 208`} role="img" aria-label="Daily stacked client estimate by usage date; positive and negative amounts share one scale, with credits below zero" className="h-64 w-full min-w-[700px]"><line x1={plotLeft} x2={plotRight} y1={baseline} y2={baseline} stroke="#94a3b8" strokeWidth="1.2"/><text x="4" y="31" fill="#64748b" fontSize="10">+£{positivePeak.toFixed(2)}</text>{negativePeak>0&&<text x="4" y="178" fill="#64748b" fontSize="10">−£{negativePeak.toFixed(2)}</text>}{daily.map((d,i)=>{const cx=plotLeft+spacing*(i+0.5),bars=[d.included,d.onDemand,d.infrastructure];let positiveOffset=0,negativeOffset=0;return <g key={d.date} role="img" aria-label={`${d.date}: known estimate ${formatGbpUnits(d.estimateKnown?d.estimate:null)}; ${d.events} events, ${d.held} held`}>{bars.map((v,j)=>{if(v===BigInt(0))return null;const positive=v>BigInt(0),height=amount(positive?v:-v)*unitsPerPixel,yPos=positive?baseline-positiveOffset-height:baseline+negativeOffset;positive?positiveOffset+=height:negativeOffset+=height;return <rect key={j} aria-label={`${['Included usage','On-demand','Infrastructure'][j]} ${formatGbpUnits(v)}`} x={cx-barWidth/2} y={yPos} width={barWidth} height={Math.max(0.8,height)} fill={colours[j]} rx="1"/>})}{d.estimateKnown===0&&<text x={cx} y={baseline-5} textAnchor="middle" fill="#b45309" fontSize="12" fontWeight="700">?</text>}{d.estimateKnown>0&&d.estimateKnown<d.events&&<circle cx={cx} cy={baseline-positiveOffset-4} r="3" fill="#d97706" stroke="white" strokeWidth="1"/>}<text x={cx} y="198" textAnchor="middle" fill="#64748b" fontSize="9">{d.date.slice(8)}</text></g>})}</svg><div className="ml-12 mt-1 flex justify-between text-[10px] text-slate-500"><span>? held / no estimate</span><span>Credits below baseline · calendar day UTC</span></div></div> : <p className="py-8 text-sm text-slate-500">No imported usage in this period.</p>}
    </section>
  </div>
}
