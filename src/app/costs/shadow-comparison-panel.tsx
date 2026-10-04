import { LEDGER_START } from '@/lib/costs/comparison-policy'
import { loadProjectComparison } from '@/lib/costs/comparison-load'
import { panel } from './ui'

function money(pence: number | null) {
  if (pence === null) return 'Unresolved'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100)
}

/** Local shadow only. Production pages leave this unset and render nothing. */
export async function ShadowComparisonPanel() {
  if (process.env.COST_SHADOW_UI !== '1') return null
  try {
    const loaded = await loadProjectComparison('itrader', LEDGER_START, null)
    const comparison = loaded.comparison
    const invoiceable = comparison.lines.some(line => line.invoiceability !== 'PROVISIONAL' || !line.provisional)
    return <section aria-label="Shadow comparison" className={panel}>
      <p className="text-xs font-semibold uppercase tracking-widest text-blue-800">Shadow comparison</p>
      <h2 className="mt-1 font-serif text-2xl font-medium">Known figures beside unresolved rows</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Dataset {process.env.COST_COMPARISON_DATASET ?? 'shadow'}. Cutoff 2026-08-13T23:00:00.000Z. Source amounts stay in their own currency. This usage value includes unassigned events on shared accounts and is not verified iTrader-only usage. iTrader remains the writer. Every usage line is provisional, so this comparison cannot create an invoice. A stored rate is kept; a reference rate used because the usage row has none is marked as an estimate. Known subtotals omit unresolved rows and are not a complete balance. {comparison.outstanding.pence === null ? 'There is no approved client-charge snapshot, so outstanding is not established.' : 'Outstanding is only the approved snapshot, not an estimate.'}</p>
      <p className="mt-3 text-sm text-slate-800">Invoiceability: {invoiceable ? 'Review required' : 'Provisional — invoice blocked'}. Outstanding approved snapshot: {comparison.outstanding.pence === null ? 'Not established' : money(comparison.outstanding.pence)}. {comparison.outstanding.reason ?? 'Approved snapshot only; estimates are not a balance.'}</p>
      <p className="mt-2 text-sm text-slate-600">Native amounts stay in USD. Paid GBP stored on a usage row: {loaded.fx.revisionRates}. Dated reference rates available before lookup: {loaded.fx.storedTableRates}. Rows that needed a reference rate: {loaded.fx.missingBeforeReference}. A reference fill is an estimate, not a paid GBP amount, and it does not rewrite the usage row. Approved GBP exists only as an approved snapshot.</p>
      <p className="mt-2 text-sm text-slate-600">{comparison.coverage.overlap.note} Held {comparison.coverage.held}, of which unassigned {comparison.coverage.unassigned}. Rows still without a pence amount: {comparison.coverage.fxMissing}. Reference estimates stay in the unresolved column and do not make the total complete. Union of unresolved rows: {comparison.coverage.overlap.unionUnresolved}. Adding held, unassigned and missing-pence would count {comparison.coverage.held + comparison.coverage.fxMissing + comparison.coverage.unassigned} and is not that union.</p>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr>{['Currency', 'Usage value', 'Provider cost', 'Client charge', 'Unresolved', 'Complete'].map(heading => <th key={heading} className="px-3 py-2 text-left">{heading}</th>)}</tr></thead><tbody>{comparison.totals.map(total => <tr key={total.currency}><td className="px-3 py-2">{total.currency}</td><td className="px-3 py-2 tabular-nums">{total.usageValue ?? 'Unresolved'}</td><td className="px-3 py-2 tabular-nums">{total.providerCost ?? 'Unresolved'}</td><td className="px-3 py-2 tabular-nums">{total.clientCharge ?? 'Unresolved'}</td><td className="px-3 py-2">Usage {total.unresolved.usageEvents}, provider {total.unresolved.providerEvents}, charge {total.unresolved.chargeEvents}, FX estimates {total.unresolved.fxEstimateEvents}</td><td className="px-3 py-2">{total.complete ? 'Yes' : 'No'}</td></tr>)}{comparison.totals.length === 0 && <tr><td className="px-3 py-3" colSpan={6}>No comparison rows in this shadow database.</td></tr>}</tbody></table></div>
    </section>
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'Comparison unavailable').replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]')
    return <section aria-label="Shadow comparison" className={panel}><h2 className="font-serif text-2xl">Shadow comparison unavailable</h2><p className="mt-2 text-sm text-slate-600">{message}</p></section>
  }
}
