import Link from 'next/link'
import { outstandingLabel } from '@/lib/costs/figures'
import type { PresentedEstimate } from '@/lib/costs/provisional-estimate'
import { panel } from './ui'

/** Current provisional estimate. Outstanding stays beside it and is not added in. */
export function ItraderEstimate({
  presentation,
  outstandingPence,
  allocatedExpensePence,
  variant,
}: {
  presentation: PresentedEstimate
  outstandingPence: number | null
  allocatedExpensePence: number
  variant: 'summary' | 'detail'
}) {
  return <section aria-label="Provisional iTrader costs" className={panel}>
    <p className="text-xs font-semibold uppercase tracking-widest text-blue-800">{presentation.title}</p>
    <p className="mt-2 font-serif text-4xl tabular-nums text-slate-950">{presentation.headline}</p>
    <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-700">{presentation.note}</p>
    <dl className="mt-4 grid gap-4 sm:grid-cols-2">
      {presentation.lines.map(line => <div key={line.label}>
        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{line.label}</dt>
        <dd className="mt-1 text-sm tabular-nums text-slate-900">{line.value}</dd>
        {(variant === 'detail' || line.label === 'Included Cursor usage' || line.label === 'On-demand Cursor' || line.label === 'Infrastructure') && <dd className="mt-1 text-xs leading-5 text-slate-500">{line.detail}</dd>}
      </div>)}
    </dl>
    <h3 className="mt-5 font-serif text-xl">Excluded from this charge</h3>
    <ul className="mt-2 space-y-2 text-sm text-slate-700">
      {presentation.exclusions.map(line => <li key={line.label}><span className="font-semibold">{line.label}.</span> {line.value} {line.detail}</li>)}
    </ul>
    <p className="mt-4 text-sm text-slate-800">Approved outstanding: {outstandingLabel(outstandingPence)}. Allocated provider expenses: {allocatedExpensePence ? outstandingLabel(allocatedExpensePence) : 'None'}. Neither is added to this estimate. Amounts exclude VAT. This is not an invoice.</p>
    <p className="mt-3 text-sm"><Link href="/costs/analysis?project=itrader#project-billing" className="font-semibold text-blue-700 underline">Open the iTrader billing report</Link>{variant === 'summary' && <> · <Link href="/costs/projects/itrader" className="font-semibold text-blue-700 underline">Open the iTrader breakdown</Link></>} · <Link href="/costs/settings" className="font-semibold text-blue-700 underline">Calculation setup</Link></p>
  </section>
}
