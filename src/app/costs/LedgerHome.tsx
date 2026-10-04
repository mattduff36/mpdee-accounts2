import Link from 'next/link'
import { unresolvedCoverageText } from '@/lib/costs/bill-coverage'
import { LEDGER_START } from '@/lib/costs/comparison-policy'
import { loadCostFigures } from '@/lib/costs/figures-load'
import { nativeText, outstandingLabel } from '@/lib/costs/figures'
import { prisma } from '@/lib/db'
import { panel } from './ui'

function lines(label: string, totals: { currency: string; units: bigint; rows: number; missing: number }[]) {
  if (!totals.length) return <p className="mt-2 text-sm text-slate-600">{label}: none in this scope</p>
  return <p className="mt-2 text-sm text-slate-800">{label}: {totals.map(total => <span key={total.currency} className="mr-3 tabular-nums">{nativeText(total)}{total.missing ? ` (${total.missing} unknown)` : ''}</span>)}</p>
}

/** Native ledger since the shared cutoff. Project cards exclude unassigned work. */
export async function LedgerHome() {
  const summary = await loadCostFigures()
  const refresh = await prisma.costRefreshStatus.findUnique({ where: { id: 'current' } })
  const infrastructure = await prisma.costUsageEvent.aggregate({ where: { provider: 'vercel', occurredAt: { gte: new Date(LEDGER_START) } }, _max: { occurredAt: true } })
  const infrastructureLatest = infrastructure._max.occurredAt ? infrastructure._max.occurredAt.toISOString() : 'none stored'
  const assigned = summary.projects.filter(project => project.assigned)
  const unassigned = summary.projects.find(project => !project.assigned)
  return <section aria-label="Project ledger" className="space-y-4">
    <div className={panel}>
      <p className="text-xs font-semibold uppercase tracking-widest text-blue-800">Ledger since 2026-08-13T23:00:00.000Z</p>
      <h2 className="mt-1 font-serif text-2xl font-medium">Known project costs</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Amounts below are native source currency. Provisional client charges use included 50%, on-demand face, and infrastructure face, with no markup. They are not approved. Reference FX in the month section is an estimate and does not set payment currency. Payment and expense currency is book GBP. {summary.usageRowsWithStoredFx} usage rows store a paid GBP rate.</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{refresh ? `Last local refresh ${refresh.finishedAt.toISOString()}. ${refresh.unavailableNote}` : 'No local refresh has been recorded. Automatic collection is not running.'}</p>
      <p className="mt-2 text-sm leading-6 text-slate-800">Unresolved bill coverage: {summary.unresolvedBills.length ? summary.unresolvedBills.map(bill => unresolvedCoverageText(bill)).join(' ') : 'none.'} {summary.unresolvedBills.length ? 'These amounts are outside the ledger bill total.' : ''}</p>
      <p className="mt-2 text-sm text-slate-700">Infrastructure collection is manual. Latest stored infrastructure event: {infrastructureLatest}. A refresh does not read a new writer export.</p>
      <p className="mt-3"><Link href="/costs/issues" className="text-sm font-semibold text-blue-700 underline">Reconciliation issues</Link></p>
    </div>
    <div className="grid gap-3 lg:grid-cols-2">
      {assigned.map(project => <article key={project.slug} className={panel}>
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-serif text-xl"><Link href={`/costs/projects/${project.slug}`} className="underline decoration-slate-300 underline-offset-4">{project.name}</Link></h3><p className="text-sm">Outstanding: {outstandingLabel(project.outstandingPence)}</p></div>
        {lines('Nominal usage', project.usage)}
        {lines('Confirmed provider cost', project.confirmedProvider)}
        {lines('Free-credit recorded charge', project.freeCredit)}
        {lines('Provisional client charge', project.provisionalCharge)}
        <p className="mt-2 text-sm text-slate-700">Allocated provider expenses: {project.allocatedExpensePence ? outstandingLabel(project.allocatedExpensePence) : 'none'}. Held events: {project.heldRows}.</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">Assigned events only. Unassigned usage and unallocated overhead are outside this total.</p>
      </article>)}
      <article className={panel}>
        <h3 className="font-serif text-xl"><Link href="/costs/projects/unassigned" className="underline decoration-slate-300 underline-offset-4">Unassigned and overhead</Link></h3>
        {unassigned ? <>{lines('Nominal usage', unassigned.usage)}{lines('Confirmed provider cost', unassigned.confirmedProvider)}{lines('Free-credit recorded charge', unassigned.freeCredit)}</> : <p className="mt-2 text-sm text-slate-600">No unassigned usage is in this database.</p>}
        <p className="mt-2 text-sm text-slate-800">Unallocated provider expenses: {outstandingLabel(summary.unallocatedBillPence)} across {summary.providerBills} bills.</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">These amounts are not added to a project. Outstanding for this scope is not established.</p>
      </article>
    </div>
  </section>
}
