import { PageHeader } from '@/components/PageHeader'
import Link from 'next/link'
import { requireAuth, canWrite } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { formatCurrency, formatDateISO } from '@/lib/format'
import { manualAllocationQuerySchema } from '@/lib/costs/manual-allocation'
import { manualAllocationInclude, stateFromAllocation } from '@/lib/costs/manual-allocation-store'
import { ManualAllocationEditor } from '../ManualAllocationEditor'
import { panel } from '../ui'

export const dynamic = 'force-dynamic'

const recordLimit = 50

export default async function SubscriptionCostsPage({ searchParams }: { searchParams: { after?: string; sourceId?: string } }) {
  const user = await requireAuth()
  const writable = canWrite(user)
  const parsed = manualAllocationQuerySchema.safeParse({ sourceKind: 'subscription_invoice', ...searchParams })
  if (!parsed.success) return <div className={panel}>Invalid invoice filter. <Link href="/costs/subscriptions">Return to all invoices</Link></div>
  const records = await prisma.costSubscriptionInvoice.findMany({
    where: parsed.data.sourceId ? { id: parsed.data.sourceId } : {},
    ...(parsed.data.after ? { cursor: { id: parsed.data.after }, skip: 1 } : {}),
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
      manualAllocation: { include: manualAllocationInclude },
    },
  })
  const invoices = records.slice(0, recordLimit)
  const projects = writable ? await prisma.costProject.findMany({
    select: { id: true, name: true, archived: true }, orderBy: { name: 'asc' },
  }) : []

  return <div className="space-y-6 pb-10">
    <PageHeader title="Subscription costs" description="Immutable provider invoices with separate user-selected project allocations." />
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
      <p>GBP amounts are reference estimates, not confirmed bank settlements or accounting expenses. These invoice records are not added to usage totals, project costs, client charges or accounting expenses.</p>
      <p className="mt-2">Manual splits are shown only in the <Link href="/costs/manual-allocations" className="underline">manual allocation report</Link>, not added to existing project totals. Missing usage does not imply zero usage. Service period end dates are exclusive.</p>
    </div>
    {!invoices.length ? <div className={panel}>
      <h2 className="text-lg font-semibold text-slate-900">No subscription invoices recorded</h2>
      <p className="mt-2 text-sm text-slate-600">Confirmed subscription invoices will appear here once imported, even if no matching usage has been collected. No subscription cost has been assumed.</p>
    </div> : <>
      <p className="text-sm text-slate-600">Showing {invoices.length} recorded {invoices.length === 1 ? 'invoice' : 'invoices'}, newest invoice date first, up to {recordLimit} per page.</p>
      <div className="space-y-4">{invoices.map(invoice => {
        const allocation = stateFromAllocation(invoice.manualAllocation)
        return <article key={invoice.id} className={panel}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-semibold text-slate-900">{invoice.provider} / {invoice.invoiceNumber}</h2>
            <p className="mt-1 break-words text-sm text-slate-600">Account: {invoice.accountRef}</p>
          </div>
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-950">{allocation.unallocatedBps === 10000 ? 'Unallocated' : 'User-selected allocation'}</span>
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
        <ManualAllocationEditor key={`${invoice.id}:${allocation.revision}`} sourceKind="subscription_invoice" sourceId={invoice.id}
          currency={invoice.currency} amountMinor={invoice.grossMinor} gbpEstimatePence={invoice.gbpEstimatePence}
          initial={allocation} projects={writable ? projects : (invoice.manualAllocation?.history[0]?.shares.map(share => ({
            id: share.projectId, name: share.project.name, archived: false,
          })) ?? [])} writable={writable} />
      </article>
      })}</div>
    </>}
    <nav aria-label="Subscription invoice pages" className="flex gap-4 text-sm text-blue-700">
      {(parsed.data.after || parsed.data.sourceId) && <Link href="/costs/subscriptions" className="underline">All invoices / first page</Link>}
      {records.length > recordLimit && <Link href={`/costs/subscriptions?after=${encodeURIComponent(invoices[invoices.length - 1].id)}`} className="underline">Older invoices</Link>}
    </nav>
  </div>
}
