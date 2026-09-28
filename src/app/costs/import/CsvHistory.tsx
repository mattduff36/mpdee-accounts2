import { prisma } from '@/lib/db'
import Link from 'next/link'
import { cursorAccounts } from '@/lib/costs/collector-status'
import { panel, inputClass, buttonClass } from '../ui'

export async function CsvHistory({ account, page }: { account?: string; page?: string }) {
  const email = cursorAccounts.find(value => value === account)
  const where = email ? { accountEmail: email } : {}
  const total = await prisma.costUsageEvidence.count({ where })
  const pageNumber = Math.min(Math.max(1, Math.floor(Number(page) || 1)), Math.max(1, Math.ceil(total / 50)))
  const rows = await prisma.costUsageEvidence.findMany({ where, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 50, skip: (pageNumber - 1) * 50 })
  const pageUrl = (next: number) => `/costs/import?${new URLSearchParams({ ...(email ? { account: email } : {}), historyPage: String(next) })}#csv-history`
  return <section id="csv-history" className={`${panel} space-y-3`}>
    <h2 className="font-semibold">CSV history awaiting precise source data</h2>
    <p className="text-sm text-slate-600">“Included” is not a zero usage value. Any numeric source cost is a rounded display value, not a verified charge. These records cannot be billed or allocated to a project from this evidence alone.</p>
    <form action="/costs/import#csv-history" className="flex flex-wrap items-end gap-3"><label className="text-sm">Source account<select className={inputClass} name="account" defaultValue={email ?? ''}><option value="">All accounts</option>{cursorAccounts.map(value => <option key={value}>{value}</option>)}</select></label><button className={buttonClass}>Filter history</button></form>
    <p className="text-sm text-slate-600">Showing {rows.length ? (pageNumber - 1) * 50 + 1 : 0}–{Math.min(pageNumber * 50, total)} of {total.toLocaleString()} recovered records.</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-indigo-50 text-slate-600"><tr>{['Date (UTC)','Account','Model','Source label','Display cost (unverified)','Tokens','Status'].map(label => <th className="whitespace-nowrap p-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map(row => <tr key={row.id}><td className="whitespace-nowrap p-3">{row.occurredAt.toISOString().replace('T',' ').slice(0,19)}</td><td className="p-3">{row.accountEmail}</td><td className="p-3">{row.model}</td><td className="p-3">{row.kind}</td><td className="p-3">{row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence) && typeof row.evidence.displayCost === 'string' ? row.evidence.displayCost : 'Not supplied'}</td><td className="p-3 tabular-nums">{row.totalTokens?.toLocaleString() ?? 'Unknown'}</td><td className="p-3 text-amber-800">{row.linkedEventId ? 'Linked to precise usage' : 'Project and precise costs missing'}</td></tr>)}</tbody></table></div>
    <nav aria-label="CSV history pages" className="flex justify-between text-sm font-medium text-indigo-700">{pageNumber > 1 ? <Link href={pageUrl(pageNumber - 1)}>Previous</Link> : <span />}{pageNumber * 50 < total && <Link href={pageUrl(pageNumber + 1)}>Next</Link>}</nav>
  </section>
}
