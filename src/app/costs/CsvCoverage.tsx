import Link from 'next/link'
import { prisma } from '@/lib/db'
import { panel } from './ui'

export async function CsvCoverage() {
  const groups = await prisma.costUsageEvidence.groupBy({ by: ['accountEmail'], _count: { _all: true }, _min: { occurredAt: true }, _max: { occurredAt: true } })
  if (!groups.length) return null
  const total = groups.reduce((sum, group) => sum + group._count._all, 0)
  return <section className={`${panel} border-amber-200 bg-amber-50/40`} aria-label="Recovered CSV history">
    <h2 className="font-semibold text-slate-900">Recovered CSV history · {total.toLocaleString()} records across all dates</h2>
    <p className="mt-2 text-sm text-slate-600">Historical usage evidence, excluded from cost and client-charge totals. The exports lack project identifiers and precise monetary values. Missing costs remain unknown.</p>
    <ul className="mt-3 grid gap-3 sm:grid-cols-2">{groups.map(group => <li key={group.accountEmail} className="rounded-lg bg-white p-3 text-sm"><span className="block break-all font-medium">{group.accountEmail}</span><span className="text-slate-600">{group._count._all.toLocaleString()} records · {group._min.occurredAt?.toISOString().slice(0,10)} to {group._max.occurredAt?.toISOString().slice(0,10)}</span></li>)}</ul>
    <p className="mt-3 text-xs text-slate-500">Dates show the first and last recorded events, not guaranteed coverage of every day. Account labels come from the selected export account.</p>
    <Link className="mt-3 inline-block text-sm font-medium text-indigo-700 underline underline-offset-4" href="/costs/import#csv-history">Inspect recovered records</Link>
  </section>
}
