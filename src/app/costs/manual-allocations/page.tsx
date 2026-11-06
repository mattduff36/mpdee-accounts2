import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { requireAuth } from '@/lib/auth'
import { manualAllocationQuerySchema } from '@/lib/costs/manual-allocation'
import { listManualAllocationReport } from '@/lib/costs/manual-allocation-store'
import { panel } from '../ui'

export const dynamic = 'force-dynamic'
const money = (currency: string, minor: number) => `${currency} ${(minor / 100).toFixed(2)}`
const gbp = (minor: number | null) => minor === null ? 'Unavailable / incomplete reference FX' : money('GBP', minor)

export default async function ManualAllocationsPage({ searchParams }: {
  searchParams: { sourceKind?: string; sourceId?: string; after?: string; asOf?: string }
}) {
  await requireAuth()
  const parsed = manualAllocationQuerySchema.safeParse({
    sourceKind: 'subscription_invoice', ...searchParams, sourceId: searchParams.sourceId === '' ? undefined : searchParams.sourceId,
  })
  if (!parsed.success) return <div className={panel}>Invalid allocation report filter. <Link href="/costs/manual-allocations" className="text-blue-700 underline">Reset filters</Link></div>
  const query = parsed.data
  const report = await listManualAllocationReport(query)
  const base = new URLSearchParams({ sourceKind: query.sourceKind, asOf: query.asOf })
  return <div className="space-y-6 pb-10">
    <PageHeader title="Manual project allocations" description="User-selected distribution of source costs, not measured usage, expenses or client charges." />
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
      Each source is subdivided once between projects and an explicit unallocated remainder. Never add source totals to their allocations, or add this report to existing cost totals. Invoice gross costs and ongoing monthly commitments are separate views, not additive categories. GBP is reference-only; missing FX is unknown, not zero.
    </div>
    <form className={`${panel} flex flex-wrap items-end gap-4`} method="get">
      <label className="text-sm">Source view<select name="sourceKind" defaultValue={query.sourceKind} className="mt-1 block rounded-lg border p-2">
        <option value="subscription_invoice">Subscription invoices (each invoice only)</option>
        <option value="custom_recurring">Active recurring commitments (monthly rate)</option>
      </select></label>
      <label className="text-sm">As of (recurring only)<input name="asOf" type="date" required min="1900-01-01" max="9999-12-31" defaultValue={query.asOf} className="mt-1 block rounded-lg border p-2" /></label>
      <label className="text-sm">Exact source ID (optional)<input name="sourceId" defaultValue={query.sourceId} maxLength={160} className="mt-1 block rounded-lg border p-2" /></label>
      <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Show report</button>
    </form>
    <section className={panel}>
      <h2 className="text-lg font-semibold">Per-project totals on this page</h2>
      <p className="mt-1 text-sm text-slate-600">{report.scope === 'invoice_only' ? 'Recorded invoice gross amounts, not a monthly run rate.' : `Enabled commitments effective on ${report.asOf}; full monthly rates, not prorated or paid costs.`} Currencies are kept separate. Follow all pages for complete coverage.</p>
      {!report.records.length ? <p className="mt-4 text-sm">No matching sources. No cost has been assumed.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr><th className="p-2">Project</th><th className="p-2">Native amount</th><th className="p-2">Reference GBP</th></tr></thead>
        <tbody>{report.pageTotals.map(total => <tr className="border-t" key={`${total.currency}:${total.projectId ?? 'unallocated'}`}>
          <td className="p-2">{total.project?.name ?? (total.projectId === null ? 'Unallocated' : total.projectId)}</td>
          <td className="p-2">{money(total.currency, total.amountMinor)}</td>
          <td className="p-2">{gbp(total.gbpEstimatePence)}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    {report.records.map(record => <article key={record.sourceId} className={panel}>
      <h2 className="font-semibold">{record.label}</h2>
      <p className="mt-1 break-all text-xs text-slate-500">Source: {record.sourceId}; allocation revision {record.allocation.revision}; {record.allocation.basis.replaceAll('_', ' ')} (not measured usage).</p>
      <p className="mt-2 text-sm">Source amount (reference, do not add again): {money(record.currency, record.amountMinor)}. Reference GBP: {gbp(record.gbpEstimatePence)}.</p>
      <p className="mt-1 text-xs text-slate-500">Period: {record.periodStart} to {record.periodEnd ?? 'no end date'} (end exclusive). {record.fx ? `FX: ${record.fx.rate} GBP, ${record.fx.date}; ${record.fx.source}` : 'No stored reference FX.'}</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
        <thead><tr><th className="p-2">Project / remainder</th><th className="p-2">Share</th><th className="p-2">Native allocation</th><th className="p-2">Reference GBP</th></tr></thead>
        <tbody>{record.buckets.map(bucket => <tr className="border-t" key={bucket.projectId ?? 'unallocated'}>
          <td className="p-2">{bucket.project?.name ?? (bucket.projectId === null ? 'Unallocated' : bucket.projectId)}</td>
          <td className="p-2">{(bucket.shareBps / 100).toFixed(2)}%</td>
          <td className="p-2">{money(record.currency, bucket.amountMinor)}</td><td className="p-2">{gbp(bucket.gbpEstimatePence)}</td>
        </tr>)}</tbody>
      </table></div>
      <Link href={`/costs/${record.sourceKind === 'subscription_invoice' ? 'subscriptions' : 'custom-recurring'}?sourceId=${encodeURIComponent(record.sourceId)}`} className="mt-3 inline-block text-sm text-blue-700 underline">View source / edit allocation</Link>
    </article>)}
    <nav aria-label="Manual allocation report pages" className="flex gap-4 text-sm text-blue-700">
      {(query.after || query.sourceId) && <Link href={`/costs/manual-allocations?${base}`} className="underline">All sources / first page</Link>}
      {report.nextCursor && <Link href={`/costs/manual-allocations?${base}&after=${encodeURIComponent(report.nextCursor)}`} className="underline">Next page</Link>}
    </nav>
  </div>
}
