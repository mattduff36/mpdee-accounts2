import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/PageHeader'
import { loadCalculationSettings } from '@/lib/costs/calculation-settings-load'
import { loadCostFigures } from '@/lib/costs/figures-load'
import { liveIssueDrafts, mergeIssue, projectIssues } from '@/lib/costs/reconciliation'
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
  const [stored, projectRow, settings] = await Promise.all([
    prisma.costReconciliationIssue.findMany({ select: { stableKey: true, status: true, resolutionNote: true } }),
    prisma.costProject.findFirst({ where: { slug }, select: { id: true } }),
    loadCalculationSettings(),
  ])
  const storedByKey = new Map(stored.map(issue => [issue.stableKey, issue]))
  const issues = projectIssues(
    liveIssueDrafts(summary).map(draft => mergeIssue(storedByKey.get(draft.stableKey) ?? null, draft)),
    project.assigned ? slug : 'unassigned',
  ).sort((a, b) => a.title.localeCompare(b.title))
  const resolved = projectRow ? settings.resolve(projectRow.id) : null
  const percent = (bps: number) => `${(bps / 100).toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}%`
  const rateCopy = resolved
    ? `Resolved rates: included premium ${percent(resolved.rates.includedPremiumBps)} of nominal, included Grok and Composer ${percent(resolved.rates.includedGrokComposerBps)}, on-demand ${percent(resolved.rates.onDemandBps)} of provider cash, infrastructure at face value. ${resolved.schedule.hostingEnabled ? `Daily hosting £${(resolved.rates.dailyHostingPence / 100).toFixed(2)} from ${resolved.schedule.hostingStartDate}${resolved.schedule.hostingEndDate ? ` to ${resolved.schedule.hostingEndDate}` : ', with no end date'}, included in the provisional charge.` : 'Daily hosting is not enabled for this project.'}`
    : 'This scope has no project calculation settings.'
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
    {slug === 'itrader' && <p className={`${panel} text-sm leading-6 text-slate-700`}>{rateCopy} Amounts exclude VAT. <Link href="/costs/settings" className="text-blue-700 underline">Calculation setup</Link></p>}
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
      <p className="mt-4 text-sm leading-6 text-slate-600">{rateCopy} Amounts exclude VAT. They are not an invoice. Held events: {project.heldRows}. {project.outstandingPence === null ? 'No approved client charge is stored, so outstanding is not established.' : 'Outstanding is the approved snapshot only.'} <Link href="/costs/settings" className="text-blue-700 underline">Calculation setup</Link> · <Link href={`/costs/analysis?project=${slug}#project-billing`} className="text-blue-700 underline">Billing report</Link></p>
    </section>}
    <section className={panel}>
      <h2 className="font-serif text-xl">Related reconciliation issues</h2>
      <ul className="mt-3 space-y-2 text-sm">{issues.map(issue => <li key={issue.id}><Link href={`/costs/issues#${issue.id}`} className="text-blue-700 underline">{issue.title}</Link> <span className="text-slate-500">· {issue.status}{issue.projectSlug ? '' : ' · shared'}</span></li>)}</ul>
      {!issues.length && <p className="mt-3 text-sm text-slate-600">Open the issues page once to record the current ledger questions.</p>}
    </section>
  </div>
}
