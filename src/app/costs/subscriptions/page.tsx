import { PageHeader } from '@/components/PageHeader'
import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { formatCurrency, formatDateISO } from '@/lib/format'
import { panel } from '../ui'

export const dynamic = 'force-dynamic'

const recordLimit = 50

export default async function SubscriptionCostsPage() {
  await requireAuth()
  const records = await prisma.costSubscriptionInvoice.findMany({
    orderBy: [{ invoiceDate: 'desc' }, { id: 'desc' }],
    take: recordLimit + 1,
    select: {
      id: true,
      provider: true,
      accountRef: true,
      invoiceNumber: true,
      currency: true,
      netMinor: true,
      taxMinor: true,
      grossMinor: true,
      invoiceDate: true,
      paymentDate: true,
      periodStart: true,
      periodEnd: true,
      gbpEstimatePence: true,
      fxRate: true,
      fxDate: true,
      fxSource: true,
      allocationStatus: true,
    },
  })
  const invoices = records.slice(0, recordLimit)

  return <div className="space-y-6 pb-10">
    <PageHeader title="Subscription costs" description="Read-only provider invoices. Confirmed native amounts are separate from estimated GBP and usage-based costs." />
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
      <p>GBP amounts are reference estimates, not confirmed bank settlements or accounting expenses. These invoice records are not added to usage totals, project costs, client charges or accounting expenses.</p>
      <p className="mt-2">Unallocated invoices have no reviewed project split. Missing usage does not hide an invoice or imply zero usage. Service period end dates are exclusive.</p>
    </div>
    {!invoices.length ? <div className={panel}>
      <h2 className="text-lg font-semibold text-slate-900">No subscription invoices recorded</h2>
      <p className="mt-2 text-sm text-slate-600">Confirmed subscription invoices will appear here once imported, even if no matching usage has been collected. No subscription cost has been assumed.</p>
    </div> : <>
      <p className="text-sm text-slate-600">Showing {invoices.length} recorded {invoices.length === 1 ? 'invoice' : 'invoices'}, newest invoice date first. This view is limited to the latest {recordLimit} records.{records.length > recordLimit && ' Older invoices are not displayed.'}</p>
      <div className="space-y-4">{invoices.map(invoice => <article key={invoice.id} className={panel}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-semibold text-slate-900">{invoice.provider} / {invoice.invoiceNumber}</h2>
            <p className="mt-1 break-words text-sm text-slate-600">Account: {invoice.accountRef}</p>
          </div>
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-950">{invoice.allocationStatus === 'unallocated' ? 'Unallocated' : invoice.allocationStatus}</span>
        </div>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          <div><dt className="font-semibold text-slate-500">Confirmed native gross</dt><dd className="mt-1 font-semibold">{invoice.currency} {(invoice.grossMinor / 100).toFixed(2)}</dd></div>
          <div><dt className="font-semibold text-slate-500">Confirmed native net</dt><dd className="mt-1">{invoice.currency} {(invoice.netMinor / 100).toFixed(2)}</dd></div>
          <div><dt className="font-semibold text-slate-500">Confirmed native tax</dt><dd className="mt-1">{invoice.currency} {(invoice.taxMinor / 100).toFixed(2)}</dd></div>
          <div><dt className="font-semibold text-slate-500">Invoice date</dt><dd className="mt-1">{formatDateISO(invoice.invoiceDate)}</dd></div>
          <div><dt className="font-semibold text-slate-500">Paid on</dt><dd className="mt-1">{formatDateISO(invoice.paymentDate)}</dd></div>
          <div><dt className="font-semibold text-slate-500">Service period (end exclusive)</dt><dd className="mt-1">{formatDateISO(invoice.periodStart)} to {formatDateISO(invoice.periodEnd)}</dd></div>
        </dl>
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
          <p className="font-semibold text-slate-900">Estimated GBP gross: {formatCurrency(invoice.gbpEstimatePence)}</p>
          <p className="mt-1 text-slate-600">Reference conversion: 1 {invoice.currency} = {invoice.fxRate.toString()} GBP, dated {formatDateISO(invoice.fxDate)}. Not an actual settlement rate.</p>
          <p className="mt-1 break-words text-xs text-slate-500">FX source: {invoice.fxSource}</p>
        </div>
      </article>)}</div>
    </>}
  </div>
}
