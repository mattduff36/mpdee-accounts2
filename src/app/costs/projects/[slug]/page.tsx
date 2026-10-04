import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/PageHeader'
import { loadCostFigures } from '@/lib/costs/figures-load'
import { liveIssueDrafts, mergeIssue, projectIssues, recordedIssueDrafts } from '@/lib/costs/reconciliation'
import { nativeText, outstandingLabel } from '@/lib/costs/figures'
import { loadProjectComparisonEstimate } from '@/lib/costs/provisional-load'
import { prisma } from '@/lib/db'
import { ItraderEstimate } from '../../ItraderEstimate'
import { panel } from '../../ui'

export const dynamic = 'force-dynamic'

export default async function ProjectCostPage({ params }: { params: { slug: string } }) {
  const slug = params.slug
  if (!/^[a-z0-9-]+$/.test(slug)) notFound()
  const summary = await loadCostFigures()
  const project = summary.projects.find(item => item.slug === slug)
  if (!project) notFound()
  const stored = await prisma.costReconciliationIssue.findMany({ select: { stableKey: true, status: true, resolutionNote: true } })
  const storedByKey = new Map(stored.map(issue => [issue.stableKey, issue]))
  const issues = projectIssues(
    [...liveIssueDrafts(summary), ...recordedIssueDrafts()].map(draft => mergeIssue(storedByKey.get(draft.stableKey) ?? null, draft)),
    project.assigned ? slug : 'unassigned',
  ).sort((a, b) => a.title.localeCompare(b.title))
  const money = (totals: typeof project.usage) => totals.length ? totals.map(total => nativeText(total)).join(', ') : 'None in this scope'
  let comparison: Awaited<ReturnType<typeof loadProjectComparisonEstimate>> = null
  let comparisonError: string | null = null
  if (slug === 'itrader') {
    try { comparison = await loadProjectComparisonEstimate(slug) } catch (error) {
      comparisonError = (error instanceof Error ? error.message : 'The provisional comparison could not be calculated.').replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]')
    }
  }
  return <div className="space-y-6 pb-10">
    <PageHeader title={project.name} description={project.assigned ? 'Assigned events only, since 2026-08-13T23:00:00.000Z.' : 'Usage and infrastructure with no project. These totals are outside every project.'} />
    {comparison && <ItraderEstimate presentation={comparison.presentation} outstandingPence={project.outstandingPence} allocatedExpensePence={project.allocatedExpensePence} variant="detail" />}
    {comparisonError && <p className={`${panel} text-sm text-slate-700`}>The provisional iTrader comparison could not be calculated. {comparisonError}</p>}
    {slug !== 'itrader' && <section className={panel}>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nominal usage</dt><dd className="mt-1 text-lg tabular-nums">{money(project.usage)}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Confirmed provider cost</dt><dd className="mt-1 text-lg tabular-nums">{money(project.confirmedProvider)}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Free-credit recorded charge</dt><dd className="mt-1 text-lg tabular-nums">{money(project.freeCredit)}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Provisional client charge</dt><dd className="mt-1 text-lg tabular-nums">{money(project.provisionalCharge)}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Allocated provider expenses</dt><dd className="mt-1 text-lg">{project.assigned ? (project.allocatedExpensePence ? outstandingLabel(project.allocatedExpensePence) : 'None') : 'Not allocated to a project'}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approved outstanding</dt><dd className="mt-1 text-lg">{outstandingLabel(project.outstandingPence)}</dd></div>
      </dl>
      <p className="mt-4 text-sm leading-6 text-slate-600">Provisional charges use the 50/100/face comparison policy and are not an invoice. Held events: {project.heldRows}. {project.outstandingPence === null ? 'No approved client charge is stored, so outstanding is not established.' : 'Outstanding is the approved snapshot only.'}</p>
    </section>}
    <section className={panel}>
      <h2 className="font-serif text-xl">Related reconciliation issues</h2>
      <ul className="mt-3 space-y-2 text-sm">{issues.map(issue => <li key={issue.id}><Link href={`/costs/issues#${issue.id}`} className="text-blue-700 underline">{issue.title}</Link> <span className="text-slate-500">· {issue.status}{issue.projectSlug ? '' : ' · shared'}</span></li>)}</ul>
      {!issues.length && <p className="mt-3 text-sm text-slate-600">Open the issues page once to record the current ledger questions.</p>}
    </section>
  </div>
}
