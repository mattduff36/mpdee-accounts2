import { requireAuth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { PageHeader } from '@/components/PageHeader'
import { loadDevelopmentReport } from '@/lib/costs/development-load'
import { DevelopmentReportError, parseDevelopmentQuery, type DevelopmentAmount } from '@/lib/costs/development-report'
import { buttonClass, inputClass, panel } from '../ui'

export const dynamic = 'force-dynamic'
type Report = Awaited<ReturnType<typeof loadDevelopmentReport>>
type Row = Report['taskMeasurements']['groups'][number] | Report['providerDailyAggregates']['groups'][number]
function amount(value: DevelopmentAmount | undefined, currency: string) {
  if (!value) return 'Not applicable'
  if (value.amount !== null) return `${currency} ${value.amount}`
  return value.knownAmount === null ? `Unknown (${value.unknown} records)` : `Unknown total; known ${currency} ${value.knownAmount}, ${value.unknown} unknown`
}

export default async function DevelopmentPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireAuth()
  const projects = await prisma.costProject.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 1000 })
  let report: Report | null = null
  let error: string | null = null
  let query: ReturnType<typeof parseDevelopmentQuery> | null = null
  try {
    query = parseDevelopmentQuery(searchParams)
    report = await loadDevelopmentReport(query)
  } catch (cause) {
    if (!(cause instanceof DevelopmentReportError)) throw cause
    error = cause.message
  }
  const value = (key: string) => typeof searchParams[key] === 'string' ? searchParams[key] as string : ''
  return <div className="space-y-6 pb-10">
    <PageHeader title="Development evidence" description="Read-only OpenAI and Codex reporting. Provider evidence and task estimates are never added together." />
    <form action="/costs/development" className={`${panel} grid gap-4 md:grid-cols-5`}>
      <label className="text-sm">From (UK date)<input className={inputClass} name="from" type="date" defaultValue={query?.from ?? value('from')} required /></label>
      <label className="text-sm">To (UK date, exclusive)<input className={inputClass} name="to" type="date" defaultValue={query?.to ?? value('to')} required /></label>
      <label className="text-sm">Project<select className={inputClass} name="projectId" defaultValue={query?.projectId ?? value('projectId')}><option value="">All projects</option><option value="unassigned">Unassigned</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label className="text-sm">Group by<select className={inputClass} name="groupBy" defaultValue={query?.groupBy ?? 'week'}><option value="day">Day</option><option value="week">UK Monday week</option><option value="month">Calendar month</option></select></label>
      <button className={`${buttonClass} self-end`}>Show evidence</button>
    </form>
    {error && <p className={`${panel} text-amber-900`} role="alert">{error}</p>}
    {report && <>
      <p className={`${panel} text-sm leading-6`}>{report.warning} Dates filter source usage timestamps, not import times, over at most 366 days. Groups use Europe/London calendar dates. GBP uses original GBP or an explicit rate recorded with the revision, never a fetched or inferred rate. Project IDs are source assignments; unassigned evidence stays explicit. No records is not evidence of zero usage.</p>
      <EvidenceSection title="Provider daily aggregates" section={report.providerDailyAggregates} task={false} />
      <EvidenceSection title="Task measurement estimates (not actual costs)" section={report.taskMeasurements} task />
    </>}
  </div>
}

function EvidenceSection({ title, section, task }: { title: string; section: { totals: Row[]; groups: Row[] }; task: boolean }) {
  return <section className={`${panel} space-y-4`}>
    <h2 className="font-serif text-2xl">{title}</h2>
    {!section.totals.length ? <p className="text-sm text-slate-600">No evidence in this selection.</p> : <>
      <h3 className="font-medium">Provider totals (currencies separate)</h3>
      <EvidenceTable rows={section.totals} task={task} />
      <h3 className="font-medium">Per-project source usage by period</h3>
      <EvidenceTable rows={section.groups} task={task} />
    </>}
  </section>
}

function EvidenceTable({ rows, task }: { rows: Row[]; task: boolean }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm">
    <thead><tr>{['Provider / period', 'Project', 'Records', task ? 'Estimated value' : 'Reported value', 'GBP value', ...(task ? [] : ['Evidenced cash', 'GBP cash']), 'Source coverage', 'Funding'].map(label => <th className="px-3 py-2" key={label}>{label}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr className="border-t border-slate-100" key={index}>
      <td className="px-3 py-3">{row.provider} / {row.period ?? 'All selected dates'}</td>
      <td className="px-3 py-3">{row.assignment === 'all' ? 'All assignments' : row.projectName ?? row.projectId ?? 'Unassigned'}</td>
      <td className="px-3 py-3">{row.records}</td>
      <td className="px-3 py-3">{amount('estimatedValue' in row ? row.estimatedValue : row.reportedValue, row.currency)}</td>
      <td className="px-3 py-3">{amount('estimatedGbp' in row ? row.estimatedGbp : row.reportedGbp, 'GBP')}</td>
      {'evidencedCash' in row && <><td className="px-3 py-3">{amount(row.evidencedCash, row.currency)}</td><td className="px-3 py-3">{amount(row.evidencedCashGbp, 'GBP')}</td></>}
      <td className="px-3 py-3">Complete {row.coverage.complete}; partial {row.coverage.partial}; unknown {row.coverage.unknown}<p className="text-xs text-slate-500">Observed {row.observedFrom} to {row.observedThrough}</p></td>
      <td className="px-3 py-3">Paid {row.funding.paid}; grant {row.funding.grant}; subscription {row.funding.subscription}; unknown {row.funding.unknown}</td>
    </tr>)}</tbody>
  </table></div>
}
