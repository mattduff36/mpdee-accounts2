import Link from 'next/link'
import { requireAuth, canWrite } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { ledger } from '@/lib/costs/service'
import { unitsText, decimalUnits, roundRatio } from '@/lib/costs/money'
import { buttonClass, inputClass, panel } from './ui'
export const dynamic = 'force-dynamic'
function money(value: bigint | null, currency: string) { return value === null ? 'Unknown' : `${currency} ${Number(unitsText(value)).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
export default async function CostsPage({ searchParams }: { searchParams: { month?: string; project?: string; page?: string } }) {
  const user = await requireAuth()
  const data = await ledger(searchParams.month, searchParams.project)
  const totals = new Map<string, { nominal: bigint; cash: bigint; charge: bigint; missing: number }>()
  for (const row of data.rows) {
    if (!row.revision) continue
    const t = totals.get(row.revision.currency) ?? { nominal: BigInt(0), cash: BigInt(0), charge: BigInt(0), missing: 0 }
    t.nominal += row.revision.nominalUnits ?? BigInt(0)
    t.cash += row.revision.providerUnits ?? BigInt(0)
    t.charge += row.charge ?? BigInt(0)
    if (row.revision.nominalUnits === null || row.revision.providerUnits === null) t.missing++
    totals.set(row.revision.currency,t)
  }
  const held = data.rows.filter(r => r.hold || r.charge === null).length
  const unassigned = data.rows.filter(r => !r.event.projectId).length
  const onDemand = data.rows.filter(r => r.event.provider === 'cursor' && r.revision?.funding === 'on-demand').length
  let gbpScaled = BigInt(0), missingFx = 0
  for (const row of data.rows) {
    if (row.charge === null || row.charge === BigInt(0)) continue
    if (!row.revision?.fxGbp) { missingFx++; continue }
    gbpScaled += row.charge * decimalUnits(row.revision.fxGbp.toString(),8)
  }
  const gbpEstimate = roundRatio(gbpScaled,BigInt('10000000000000'))
  const perProject = new Map<string, { name: string; currency: string; amount: bigint; count: number }>()
  for (const row of data.rows) {
    const currency = row.revision?.currency ?? 'USD'
    const key = `${row.event.projectId ?? 'unassigned'}:${currency}`
    const total = perProject.get(key) ?? { name: row.event.project?.name ?? 'Unassigned', currency, amount: BigInt(0), count: 0 }
    total.amount += row.charge ?? BigInt(0); total.count++
    perProject.set(key,total)
  }
  const pageSize = 50
  const pageCount = Math.max(1, Math.ceil(data.rows.length / pageSize))
  const requestedPage = Number(searchParams.page)
  const page = Math.min(pageCount, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1)
  const pageHref = (value: number) => '/costs?' + new URLSearchParams({ month: data.month, project: searchParams.project ?? '', page: String(value) })
  return <div className="space-y-6">
    <PageHeader title="Project costs" description="Account-wide usage, project allocation and client charge estimates.">
      {canWrite(user) && <><Link className={buttonClass} href="/costs/import">Import usage</Link><Link className="inline-flex min-h-11 items-center rounded text-sm font-medium text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500" href="/costs/projects">Projects & rates</Link><Link className="inline-flex min-h-11 items-center rounded text-sm font-medium text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500" href="/costs/review">Review unassigned</Link></>}
      <a className="inline-flex min-h-11 items-center rounded text-sm font-medium text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500" href={`/api/costs/export?month=${data.month}&project=${encodeURIComponent(searchParams.project ?? '')}`}>Export ledger</a>
    </PageHeader>
    <form className={`${panel} grid items-end gap-4 sm:grid-cols-[1fr_2fr_auto]`}>
      <label className="text-sm">Month (UTC)<input aria-label="Month" className={inputClass} type="month" name="month" defaultValue={data.month} /></label>
      <label className="text-sm">Project<select className={inputClass} name="project" defaultValue={searchParams.project ?? ''}><option value="">All projects</option><option value="unassigned">Unassigned</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <button className={buttonClass}>Apply filters</button>
    </form>
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">Charges are estimates, separate from invoices and accounting expenses.<details className="mt-1"><summary className="cursor-pointer py-2 font-medium">How these figures work</summary><p className="mt-1 leading-relaxed">iTrader’s existing ledger remains active. Included usage is a service value, not a cash expense. Allowance remaining is unknown until the account’s billing cycle and credit pools are verified.</p></details></div>
    <div className="grid gap-4 sm:grid-cols-3">
      <div className={panel}><p className="text-sm text-slate-500">Usage records</p><p className="mt-2 text-3xl font-bold">{data.rows.length.toLocaleString()}</p></div>
      <div className={panel}><p className="text-sm text-slate-500">Held from client estimate</p><p className="mt-2 text-3xl font-bold text-amber-700">{held}</p><p className="mt-2 text-xs text-slate-500">{unassigned} unassigned · {onDemand} on-demand Cursor events</p></div>
      <div className={panel}><p className="text-sm text-slate-500">Most recent import</p><p className="mt-2 font-semibold">{data.imports[0]?.createdAt.toISOString().replace('T',' ').slice(0,16) ?? 'No imports yet'}</p><p className="mt-2 text-xs text-slate-500">{data.imports[0] ? `${data.imports[0].provider} · ${data.imports[0].quality} coverage · UTC` : 'Start by adding projects and importing account usage.'}</p></div>
    </div>
    {Array.from(totals).map(([currency,t]) => <div key={currency} className={`${panel} grid gap-4 sm:grid-cols-3`}>
      <div><p className="text-sm text-slate-500">Nominal usage value</p><p className="text-xl font-semibold">{money(t.nominal,currency)}</p></div>
      <div><p className="text-sm text-slate-500">Provider charges in imported records</p><p className="text-xl font-semibold">{money(t.cash,currency)}</p><p className="text-xs text-slate-500">Subscription invoices must be imported separately.</p></div>
      <div><p className="text-sm text-slate-500">Client charge estimate</p><p className="text-xl font-semibold">{money(t.charge,currency)}</p><p className="text-xs text-slate-500">Held records excluded.{t.missing > 0 ? ` ${t.missing} records have missing monetary values. Totals are incomplete.` : ''}</p></div>
    </div>)}
    <div className={panel}><p className="text-sm text-slate-500">GBP charge estimate using recorded exchange rates</p><p className="mt-1 text-xl font-semibold">£{(Number(gbpEstimate)/100).toFixed(2)}</p><p className="mt-1 text-xs text-slate-500">{missingFx} chargeable records excluded because no GBP exchange rate is recorded. Held records are also excluded. Rates are provided with the import, never guessed.</p></div>
    <div className={panel}><h2 className="mb-4 font-semibold">By project</h2>{perProject.size ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from(perProject).map(([key,t]) => <div key={key} className="rounded-xl bg-slate-50 p-4"><p className="font-medium">{t.name}</p><p className="mt-1 text-xl">{money(t.amount,t.currency)}</p><p className="text-xs text-slate-500">{t.count} events · charge estimate</p></div>)}</div> : <p className="text-sm text-slate-500">No usage in this period. Imports retain all projects, including unassigned work.</p>}</div>
    <div className={panel}><h2 className="mb-4 font-semibold">Usage ledger</h2><p className="mb-4 text-sm text-slate-500">Showing {data.rows.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize,data.rows.length)} records. Totals and export include all {data.rows.length} records in this filter. Amounts are rounded only for display.</p><div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead><tr className="border-b text-slate-500">{['Time (UTC)','Project / provider','Funding','Provider cost','Charge estimate','Status'].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{data.rows.slice((page - 1) * pageSize,page * pageSize).map(r => <tr className="border-b last:border-0" key={r.event.id}><td className="whitespace-nowrap p-3">{r.event.occurredAt.toISOString().replace('T',' ').slice(0,19)}</td><td className="p-3"><div>{r.event.project?.name ?? 'Unassigned'}</div><div className="text-xs text-slate-500">{r.event.provider} · {r.event.model ?? 'Infrastructure'}</div></td><td className="p-3">{r.revision?.funding}</td><td className="p-3 whitespace-nowrap">{money(r.revision?.providerUnits ?? null,r.revision?.currency ?? 'USD')}</td><td className="p-3 whitespace-nowrap">{money(r.charge,r.revision?.currency ?? 'USD')}</td><td className="p-3 text-xs">{r.hold ?? (r.policy?.billable ? 'Ready for review' : 'Internal / non-billable')}</td></tr>)}</tbody></table></div>
      <ul className="divide-y divide-slate-100 md:hidden">{data.rows.slice((page - 1) * pageSize,page * pageSize).map(r => <li className="py-4" key={r.event.id}>
        <div className="flex items-start justify-between gap-3"><p className="font-semibold">{r.event.project?.name ?? 'Unassigned'}</p><p className="shrink-0 font-semibold tabular-nums">{money(r.charge,r.revision?.currency ?? 'USD')}</p></div>
        <p className="mt-1 text-xs text-slate-500">{r.event.occurredAt.toISOString().replace('T',' ').slice(0,16)} UTC · {r.event.provider}</p>
        <p className="mt-2 break-words text-sm text-slate-600">{r.event.model ?? 'Infrastructure'} · {r.revision?.funding}</p>
        <p className="mt-2 text-xs text-slate-600">Provider cost: {money(r.revision?.providerUnits ?? null,r.revision?.currency ?? 'USD')}</p>
        <p className="mt-2 text-xs font-medium text-slate-700">{r.hold ?? (r.policy?.billable ? 'Ready for review' : 'Internal / non-billable')}</p>
      </li>)}</ul><nav aria-label="Usage ledger pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-slate-600">Page {page} of {pageCount}</span><div className="flex gap-3">{page > 1 && <Link className={buttonClass} href={pageHref(page - 1)}>Previous</Link>}{page < pageCount && <Link className={buttonClass} href={pageHref(page + 1)}>Next</Link>}</div></nav></div>
    <p className="text-xs text-slate-500">Currencies are kept separate. FX values, where supplied, are retained on each revision. No tax, invoice or payment entries are created by this module.</p>
  </div>
}
