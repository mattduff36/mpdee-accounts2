import Link from 'next/link'
import { formatCurrency } from '@/lib/format'
export function InvoiceCostBar({ invoiceId, netPence, cost, associated, incomplete }: { invoiceId: string; netPence: number; cost?: { direct: number; subscription: number }; associated: boolean; incomplete: boolean }) {
  if (!associated) return <Link href={`/costs/analysis?invoice=${invoiceId}#invoice-links`} className="mt-3 block border-t border-slate-200 pt-2 text-xs font-medium text-blue-700 hover:underline">Link project and service period to see costs →</Link>
  const direct = cost?.direct || 0, subscription = cost?.subscription || 0, total = direct + subscription
  const percentage = netPence > 0 ? total / netPence * 100 : null
  const scale = Math.max(netPence, 1)
  return <div className="mt-3 space-y-1.5">
    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs"><span className="text-slate-600">Allocated costs {formatCurrency(total)}</span><span className="font-medium text-slate-800">{percentage === null ? 'No positive net revenue' : `${percentage.toFixed(1)}% of net invoice`}</span></div>
    <div className="flex h-1.5 overflow-hidden rounded-full bg-emerald-100" role="img" aria-label={`Direct costs ${formatCurrency(direct)}, subscriptions ${formatCurrency(subscription)}, against net invoice ${formatCurrency(netPence)}${incomplete ? '. Allocation incomplete' : ''}`}>
      <span className="shrink-0 bg-rose-500" style={{width:`${Math.max(0,direct)/scale*100}%`}}/><span className="shrink-0 bg-amber-500" style={{width:`${Math.max(0,subscription)/scale*100}%`}}/>
    </div>
    <p className="text-xs text-slate-500">Rose: direct · amber: subscriptions · full bar: net invoice</p>
    <p className="text-xs text-slate-500">{total > netPence && netPence > 0 ? 'Costs exceed invoice value. ' : ''}{direct < 0 || subscription < 0 ? 'Refunds reduce the total; bar shows positive costs. ' : ''}{incomplete ? <Link className="text-amber-800 hover:underline" href={`/costs/analysis?invoice=${invoiceId}#allocations`}>Partial allocation · review costs</Link> : 'Reviewed allocation'}</p>
  </div>
}
