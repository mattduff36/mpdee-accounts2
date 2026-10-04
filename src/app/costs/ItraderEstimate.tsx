import Link from 'next/link'
import { outstandingLabel } from '@/lib/costs/figures'
import type { PresentedEstimate } from '@/lib/costs/provisional-estimate'
import { panel } from './ui'

/** Provisional comparison charge. Outstanding and stored-policy amounts stay beside it. */
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
  return <section aria-label="Provisional iTrader comparison charge" className={panel}>
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
    {variant === 'detail' && <div className="mt-5 space-y-2 text-sm leading-6 text-slate-700">
      <h3 className="font-serif text-xl text-slate-950">Pricing and GBP conversion</h3>
      {presentation.pricing.map(line => <p key={line}>{line}</p>)}
      {presentation.storedPolicy && <p><span className="font-semibold">{presentation.storedPolicy.label}:</span> {presentation.storedPolicy.value}. {presentation.storedPolicy.detail}</p>}
    </div>}
    {variant === 'summary' && presentation.storedPolicy && <p className="mt-4 text-sm leading-6 text-slate-700"><span className="font-semibold">{presentation.storedPolicy.label}:</span> {presentation.storedPolicy.value}. The saved daily rate is not applied. This is separate from the comparison charge.</p>}
    <p className="mt-4 text-sm text-slate-800">Approved outstanding: {outstandingLabel(outstandingPence)}. Allocated provider expenses: {allocatedExpensePence ? outstandingLabel(allocatedExpensePence) : 'None'}. Neither is added to the comparison charge.</p>
    {variant === 'summary' && <p className="mt-3"><Link href="/costs/projects/itrader" className="text-sm font-semibold text-blue-700 underline">Open the iTrader breakdown</Link></p>}
  </section>
}
