import Link from 'next/link'
import { unresolvedCoverageText } from '@/lib/costs/bill-coverage'
import type { CostSummary } from '@/lib/costs/figures'

/** Account-wide historical bills whose service periods are still unresolved. */
export function HistoricalBills({ bills }: { bills: CostSummary['unresolvedBills'] }) {
  if (!bills.length) return <p className="text-sm text-slate-600">Historical provider bills with unverified service periods: none.</p>
  const gross = bills.reduce((total, bill) => total + bill.grossPence, 0)
  return <div className="text-sm leading-6 text-slate-700">
    <p><span className="font-semibold">Historical provider bills with unverified service periods.</span> {bills.length} accounts-book rows sit outside the ledger bill total. The figure is GBP accounts-book gross. It can include VAT, so it is not an ex-VAT client cost. The rows stay in the accounts book.</p>
    <details className="mt-2">
      <summary className="cursor-pointer font-semibold text-blue-800">Show the {bills.length} bill details</summary>
      <p className="mt-2">Accounts-book gross of these rows: £{(gross / 100).toFixed(2)} GBP. Gross includes any VAT recorded on the bill and is distinct from a net ex-VAT client charge.</p>
      <ul className="mt-2 space-y-2">{bills.map((bill, index) => <li key={`${bill.reference}:${bill.booked}:${index}`}>{unresolvedCoverageText(bill)}</li>)}</ul>
    </details>
    <p className="mt-2"><Link href="/costs/issues#unresolved-bill-coverage" className="font-semibold text-blue-700 underline">Open these bills on the issues page</Link></p>
  </div>
}
