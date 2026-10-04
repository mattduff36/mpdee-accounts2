import Link from 'next/link'
import { canWrite, requireAuth } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { unresolvedCoverageText } from '@/lib/costs/bill-coverage'
import { LEDGER_START } from '@/lib/costs/comparison-policy'
import { loadCostFigures } from '@/lib/costs/figures-load'
import { liveIssueDrafts, mergeIssue, recordedIssueDrafts } from '@/lib/costs/reconciliation'
import { prisma } from '@/lib/db'
import { inputClass, panel } from '../ui'
import { applyExpenseShare, reviewIssue, saveBillMetadata } from './actions'

export const dynamic = 'force-dynamic'

export default async function ReconciliationIssuesPage({ searchParams }: { searchParams: { status?: string; project?: string } }) {
  const user = await requireAuth()
  const writable = canWrite(user)
  const summary = await loadCostFigures()
  const status = ['open', 'reviewed', 'resolved'].includes(searchParams.status ?? '') ? searchParams.status : ''
  const project = searchParams.project && /^[a-z0-9-]+$/.test(searchParams.project) ? searchParams.project : ''
  const stored = await prisma.costReconciliationIssue.findMany({ include: { events: { orderBy: { createdAt: 'desc' }, take: 8 } } })
  const storedByKey = new Map(stored.map(issue => [issue.stableKey, issue]))
  const issues = [...liveIssueDrafts(summary), ...recordedIssueDrafts()].map(draft => {
    const row = storedByKey.get(draft.stableKey)
    return { ...mergeIssue(row ?? null, draft), events: row?.events ?? [] }
  }).filter(issue => !status || issue.status === status)
    .filter(issue => !project || (project === 'shared' ? issue.projectSlug === null : issue.projectSlug === project))
    .sort((a, b) => a.title.localeCompare(b.title))
  const refresh = await prisma.costRefreshStatus.findUnique({ where: { id: 'current' } })
  const infrastructure = await prisma.costUsageEvent.aggregate({ where: { provider: 'vercel', occurredAt: { gte: new Date(LEDGER_START) } }, _max: { occurredAt: true } })
  const infrastructureLatest = infrastructure._max.occurredAt ? infrastructure._max.occurredAt.toISOString() : 'none stored'
  const [expenses, projects] = await Promise.all([
    prisma.expense.findMany({
      where: { isArchived: false, date: { gte: new Date(LEDGER_START) }, OR: [{ supplier: { contains: 'cursor', mode: 'insensitive' } }, { supplier: { contains: 'vercel', mode: 'insensitive' } }, { supplier: { contains: 'supabase', mode: 'insensitive' } }] },
      include: { costAllocations: true },
      orderBy: { date: 'asc' },
    }),
    prisma.costProject.findMany({ where: { archived: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true } }),
  ])
  return <div className="space-y-6 pb-10">
    <PageHeader title="Reconciliation issues" description="Open questions stay visible. Marking an issue reviewed or resolved does not change usage, bills, payments, or approved charges." />
    <p className="max-w-3xl text-sm leading-6 text-slate-600">{refresh ? `Last refresh ${refresh.finishedAt.toISOString()}. ${refresh.unavailableNote}` : 'No local refresh has been recorded. Automatic collection is not running.'}</p>
    <p className="max-w-3xl text-sm leading-6 text-slate-800">Unresolved bill coverage: {summary.unresolvedBills.length ? summary.unresolvedBills.map(bill => unresolvedCoverageText(bill)).join(' ') : 'none.'}</p>
    <p className="max-w-3xl text-sm text-slate-700">Infrastructure collection is manual. Latest stored infrastructure event: {infrastructureLatest}. A refresh does not read a new writer export.</p>
    <nav aria-label="Issue filters" className="flex flex-wrap gap-2 text-sm">
      {[['', 'All'], ['open', 'Open'], ['reviewed', 'Reviewed'], ['resolved', 'Resolved']].map(([value, label]) => <Link key={label} href={value ? `/costs/issues?status=${value}` : '/costs/issues'} className="rounded-full border border-slate-300 px-3 py-1">{label}</Link>)}
      <Link href="/costs/issues?project=itrader" className="rounded-full border border-slate-300 px-3 py-1">iTrader</Link>
      <Link href="/costs/issues?project=shared" className="rounded-full border border-slate-300 px-3 py-1">Shared</Link>
    </nav>
    {issues.map(issue => <article key={issue.id} id={issue.id} className={panel}>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-serif text-2xl">{issue.title}</h2><p className="text-sm uppercase tracking-wide text-slate-500">{issue.status}</p></div>
      <p className="mt-3 text-sm leading-6 text-slate-700">{issue.description}</p>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold text-slate-500">Scope</dt><dd>{issue.projectSlug ?? 'Shared / no single project'} · {issue.provider ?? 'Several providers'} · {issue.accountRef ?? 'No single account'}</dd></div>
        <div><dt className="font-semibold text-slate-500">Period</dt><dd>{issue.periodStart ?? 'Unknown'}{issue.periodEnd ? ` to ${issue.periodEnd}` : ''}</dd></div>
        <div><dt className="font-semibold text-slate-500">Amount</dt><dd>{issue.amountUnknown ? `Unknown${issue.currency ? ` · ${issue.currency}` : ''}` : issue.amountText}</dd></div>
        <div><dt className="font-semibold text-slate-500">Evidence</dt><dd>{issue.evidenceRef}</dd></div>
        <div><dt className="font-semibold text-slate-500">Effect on totals</dt><dd>{issue.effectOnTotals}</dd></div>
        <div><dt className="font-semibold text-slate-500">Billing</dt><dd>{issue.billingEffect}</dd></div>
      </dl>
      <p className="mt-3 text-sm text-slate-800"><span className="font-semibold">Still required. </span>{issue.requiredAction}</p>
      {issue.resolutionNote && <p className="mt-2 text-sm text-slate-600">Latest note: {issue.resolutionNote}</p>}
      <ol className="mt-3 space-y-1 text-xs text-slate-500">{issue.events.map(event => <li key={event.id}>{event.createdAt.toISOString()} · {event.action} · {event.note}</li>)}</ol>
      {writable && <form action={reviewIssue} className="mt-4 grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
        <input type="hidden" name="stableKey" value={issue.stableKey} />
        <label className="text-sm">Status<select name="status" defaultValue={issue.status} className={inputClass}><option value="open">Open</option><option value="reviewed">Reviewed</option><option value="resolved">Resolved</option></select></label>
        <label className="text-sm">Review note<textarea name="note" required minLength={3} maxLength={2000} className={inputClass} placeholder="What you checked. This does not change a cost." /></label>
        <button className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold">Save review</button>
      </form>}
      {writable && issue.id === 'provider-bills' && <div className="mt-6 space-y-4 border-t border-slate-200 pt-4">{expenses.map(expense => {
        const allocated = expense.costAllocations.reduce((total, share) => total + share.amountPence, 0)
        return <div key={expense.id} className="rounded-xl bg-slate-50 p-4">
          <h3 className="font-medium">{expense.supplier} · {expense.reference ?? 'No reference'} · £{(expense.grossAmount / 100).toFixed(2)}</h3>
          <p className="mt-1 text-xs text-slate-600">{expense.description.includes('@') ? 'Description omitted because it contains an address.' : expense.description} Allocated £{(allocated / 100).toFixed(2)}. Remaining £{((expense.grossAmount - allocated) / 100).toFixed(2)}. Book currency is GBP. A usage exchange rate does not change it.</p>
          <form action={saveBillMetadata} className="mt-3 grid gap-2 sm:grid-cols-4">
            <input type="hidden" name="expenseId" value={expense.id} />
            <label className="text-xs">Provider account<input name="accountRef" defaultValue={expense.providerAccountRef ?? ''} className={inputClass} placeholder="Token, not an email" /></label>
            <label className="text-xs">Service<select name="serviceName" defaultValue={expense.serviceName ?? ''} className={inputClass}><option value="">Unknown</option><option>subscription</option><option>on-demand</option><option>infrastructure</option><option>membership</option></select></label>
            <label className="text-xs">Period start<input type="date" name="periodStart" defaultValue={expense.billingPeriodStart?.toISOString().slice(0, 10) ?? ''} className={inputClass} /></label>
            <label className="text-xs">Period end<input type="date" name="periodEnd" defaultValue={expense.billingPeriodEnd?.toISOString().slice(0, 10) ?? ''} className={inputClass} /></label>
            <button className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm sm:col-span-4">Save bill metadata</button>
          </form>
          <form action={applyExpenseShare} className="mt-3 grid gap-2 sm:grid-cols-4">
            <input type="hidden" name="expenseId" value={expense.id} />
            <input type="hidden" name="confirm" value="apply" />
            <label className="text-xs">Project<select name="projectId" className={inputClass}>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="text-xs">GBP share<input name="amount" className={inputClass} placeholder="0.00" /></label>
            <label className="text-xs">Period start<input type="date" name="periodStart" required className={inputClass} /></label>
            <label className="text-xs">Period end<input type="date" name="periodEnd" required className={inputClass} /></label>
            <label className="text-xs sm:col-span-3">Why this share is evidenced<textarea name="note" required minLength={3} className={inputClass} /></label>
            <button className="min-h-11 rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white">Apply share</button>
          </form>
          <p className="mt-2 text-xs text-slate-500">Preview: the original expense stays. The share is counted once, cannot exceed the gross amount, and does not approve a client charge or suppress usage.</p>
        </div>
      })}</div>}
    </article>)}
    {!issues.length && <p className="text-sm text-slate-600">No issues match this filter. <Link href="/costs" className="text-blue-700 underline">Back to project costs</Link></p>}
  </div>
}
