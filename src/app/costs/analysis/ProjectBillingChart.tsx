type Point = { day: string; costPence: number | null; invoicedPence: number; remainingToInvoicePence: number | null }

const width = 720
const height = 270
const pad = { left: 82, right: 20, top: 18, bottom: 38 }
const shortDate = (day: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(day + 'T00:00:00Z'))

function money(pence: number | null) {
  if (pence === null) return 'Unknown'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100)
}

export function ProjectBillingChart({ history }: { history: Point[] }) {
  const known = history.flatMap(point => [point.costPence, point.invoicedPence, point.remainingToInvoicePence].filter((value): value is number => value !== null))
  const min = Math.min(0, ...(known.length ? known : [0]))
  const max = Math.max(0, ...(known.length ? known : [0]))
  const span = max - min || 1
  const xAt = (index: number) => history.length <= 1 ? (pad.left + width - pad.right) / 2 : pad.left + (index * (width - pad.left - pad.right)) / (history.length - 1)
  const yAt = (value: number) => pad.top + (height - pad.top - pad.bottom) * (1 - (value - min) / span)
  const series = [
    { key: 'cost', label: 'Recorded costs', stroke: '#2563eb', dash: undefined, value: (point: Point) => point.costPence },
    { key: 'invoiced', label: 'Net invoiced', stroke: '#334155', dash: '6 4', value: (point: Point) => point.invoicedPence },
    { key: 'remaining', label: 'Remaining to invoice', stroke: '#b45309', dash: '2 3', value: (point: Point) => point.remainingToInvoicePence },
  ] as const
  const runs = (pick: (point: Point) => number | null) => {
    const segments: { x: number; y: number }[][] = []
    let current: { x: number; y: number }[] = []
    history.forEach((point, index) => {
      const value = pick(point)
      if (value === null) {
        if (current.length) segments.push(current)
        current = []
        return
      }
      current.push({ x: xAt(index), y: yAt(value) })
    })
    if (current.length) segments.push(current)
    return segments
  }
  const ticks = max === min ? [0] : Array.from({ length: 5 }, (_, index) => min + span * index / 4)
  const dateIndices = history.length ? [...new Set([0, 0.25, 0.5, 0.75, 1].map(fraction => Math.round((history.length - 1) * fraction)))] : []
  const axisMoney = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: span < 2000 ? 2 : 0 })
  const last = history[history.length - 1]
  const summary = last
    ? 'Latest ' + last.day + ': recorded costs ' + money(last.costPence) + ', net invoiced ' + money(last.invoicedPence) + ', remaining to invoice ' + money(last.remainingToInvoicePence) + '. The vertical scale includes ' + money(min) + ' to ' + money(max) + '. Gaps indicate unknown costs.'
    : 'No cumulative history is available.'
  return <figure className="min-w-0 space-y-3">
    <div role="region" aria-label="Cumulative project billing chart" className="max-w-full overflow-x-auto">
      <svg role="img" aria-labelledby="project-billing-chart-title project-billing-chart-desc" viewBox={'0 0 ' + width + ' ' + height} className="h-auto min-w-[600px] w-full">
        <title id="project-billing-chart-title">Cumulative project costs, net invoiced and remaining</title>
        <desc id="project-billing-chart-desc">{summary}</desc>
        {ticks.map((value, index) => <g key={index}>
          <line x1={pad.left} x2={width - pad.right} y1={yAt(value)} y2={yAt(value)} stroke="#e2e8f0" strokeWidth="1" />
          <text x={pad.left - 10} y={yAt(value) + 4} textAnchor="end" fontSize="11" fill="#64748b">{axisMoney.format(value / 100)}</text>
        </g>)}
        <line x1={pad.left} x2={width - pad.right} y1={yAt(0)} y2={yAt(0)} stroke="#94a3b8" strokeWidth="1" />
        {dateIndices.map(index => <text key={index} x={xAt(index)} y={height - 12} textAnchor={index === 0 ? 'start' : index === history.length - 1 ? 'end' : 'middle'} fontSize="11" fill="#64748b">{shortDate(history[index].day)}</text>)}
        {series.map(item => runs(item.value).map((points, index) => points.length === 1
          ? <circle key={item.key + '-' + index} data-billing-series={item.key} cx={points[0].x} cy={points[0].y} r="3" fill={item.stroke} />
          : <polyline key={item.key + '-' + index} data-billing-series={item.key} fill="none" stroke={item.stroke} strokeWidth="2" strokeDasharray={item.dash} points={points.map(point => point.x.toFixed(2) + ',' + point.y.toFixed(2)).join(' ')} />))}
      </svg>
    </div>
    <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {series.map(item => <span key={item.key} className="inline-flex items-center gap-2"><span className="inline-block w-6" style={{ borderTop: '2px ' + (item.key === 'remaining' ? 'dotted' : item.dash ? 'dashed' : 'solid') + ' ' + item.stroke }} aria-hidden="true" />{item.label}</span>)}
      <span>Gaps indicate unknown costs. Negative amounts appear below zero.</span>
    </figcaption>
  </figure>
}
