import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { requireAuth, canWrite } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { customRecurringQuerySchema } from '@/lib/costs/custom-recurring'
import { customRecurringDto } from '@/lib/costs/custom-recurring-store'
import { panel } from '../ui'
import { RecurringEditor } from './RecurringEditor'

export const dynamic = 'force-dynamic'

export default async function CustomRecurringPage({ searchParams }: { searchParams: { after?: string } }) {
  const user = await requireAuth()
  const writable = canWrite(user)
  const parsed = customRecurringQuerySchema.safeParse({ after: searchParams.after, limit: '50' })
  if (!parsed.success) return <div className={panel}>Invalid page cursor. <Link href="/costs/custom-recurring" className="text-blue-700 underline">Return to the first page</Link></div>
  const rows = await prisma.costCustomRecurring.findMany({
    where: parsed.data.after ? { id: { gt: parsed.data.after } } : {},
    orderBy: { id: 'asc' }, take: 51,
    include: { project: { select: { slug: true, name: true } } },
  })
  const projects = writable ? await prisma.costProject.findMany({
    select: { id: true, name: true, archived: true }, orderBy: { name: 'asc' },
  }) : []
  const records = rows.slice(0, 50)
  return <div className="space-y-6 pb-10">
    <PageHeader title="Custom recurring costs" description="Owner-entered monthly development commitments, separate from paid invoices and client finance." />
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
      Monthly rates are commitments, not proof of payment. Payment and tax are unknown. No charges, expenses, period estimates or currency conversions are generated. These rates do not enter existing financial totals. End dates are exclusive; an active flag does not override the effective dates.
    </div>
    {writable && <section className={panel}>
      <h2 className="mb-4 text-lg font-semibold">Add a recurring commitment</h2>
      <RecurringEditor projects={projects} />
    </section>}
    {!records.length && <p className={panel}>No recurring commitments on this page. No cost or payment is assumed.</p>}
    {records.map(row => <article key={row.id} className={panel}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="break-words text-lg font-semibold">{row.provider} / {row.name}</h2>
          <p className="mt-1 text-sm text-slate-600">{row.project.name} ({row.project.slug})</p></div>
        <p className="font-semibold">{row.currency} {(row.amountMinor / 100).toFixed(2)} / month</p>
      </div>
      <p className="mt-3 text-sm text-slate-600">{row.active ? 'Enabled' : 'Disabled'}; from {row.effectiveStart.toISOString().slice(0, 10)} to {row.effectiveEnd?.toISOString().slice(0, 10) ?? 'no end date'} (end exclusive). Revision {row.revision}.</p>
      {writable && <details className="mt-4"><summary className="cursor-pointer font-medium text-blue-700">Edit or disable</summary>
        <div className="mt-4"><RecurringEditor key={row.revision} projects={projects} record={{ ...customRecurringDto(row), notes: row.notes }} /></div>
      </details>}
    </article>)}
    <nav aria-label="Recurring cost pages" className="flex gap-4 text-sm text-blue-700">
      {parsed.data.after && <Link href="/costs/custom-recurring" className="underline">First page</Link>}
      {rows.length > 50 && <Link href={`/costs/custom-recurring?after=${encodeURIComponent(records[records.length - 1].id)}`} className="underline">Next page</Link>}
    </nav>
  </div>
}
