import Link from 'next/link'
import { unresolvedCoverageText } from '@/lib/costs/bill-coverage'
import type { CostSummary } from '@/lib/costs/figures'

/** Account-wide historical bills. Their gross is not an iTrader comparison charge. */
export function HistoricalBills({ bills }: { bills: CostSummary['unresolvedBills'] }) {
  if (!bills.length) return <p className="text-sm text-slate-600">Historical provider bills with unverified service periods: none.</p>
  const preserved = bills.find(bill => bill.reference === 'CH4KCVQF-0040')
  const gross = bills.reduce((total, bill) => total + bill.grossPence, 0)
  return <div className="text-sm leading-6 text-slate-700">
    <p><span className="font-semibold">Historical provider bills with unverified service periods.</span> {bills.length} accounts-book rows sit outside the ledger bill total. Their gross is not an iTrader charge and is not added to the provisional comparison.</p>
    {preserved && <p className="mt-2">CH4KCVQF-0040 remains separate: £{(preserved.grossPence / 100).toFixed(2)}. Original book date {preserved.booked}. Notes record source date {preserved.sourceDate ?? 'none'}. No service period or allocation is established. It stays outside the ledger bill total. Coverage is unresolved.</p>}
    <details className="mt-2">
      <summary className="cursor-pointer font-semibold text-blue-800">Show the {bills.length} bill details</summary>
      <p className="mt-2">Accounts-book gross of these rows: £{(gross / 100).toFixed(2)}. This gross is not added to iTrader.</p>
      <ul className="mt-2 space-y-2">{bills.map((bill, index) => <li key={`${bill.reference}:${bill.booked}:${index}`}>{unresolvedCoverageText(bill)}</li>)}</ul>
    </details>
    <p className="mt-2"><Link href="/costs/issues#unresolved-bill-coverage" className="font-semibold text-blue-700 underline">Open these bills on the issues page</Link></p>
  </div>
}
