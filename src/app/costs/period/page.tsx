import Link from 'next/link'
import { requireAuth } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { prisma } from '@/lib/db'
import { nativeText, type MoneyTotal } from '@/lib/costs/figures'
import { formatGbpUnits } from '@/lib/costs/fx-values'
import { UNIT } from '@/lib/costs/money'
import { loadClientPeriod, type ClientPeriodProject, type ClientPeriodReport } from '@/lib/costs/period-usage-load'
import { parseInclusivePeriod, type GbpCoverage } from '@/lib/costs/period-usage'
import { formatCurrency } from '@/lib/format'
import { buttonClass, inputClass, panel } from '../ui'

export const dynamic = 'force-dynamic'

function gbpText(bucket: GbpCoverage) {
  if (bucket.known === 0 && bucket.missing === 0) return 'None'
  return `${formatGbpUnits(bucket.known ? bucket.units : null)}${bucket.missing ? '*' : ''}`
}

function nativeLine(totals: MoneyTotal[]) {
  return totals.length ? totals.map(total => nativeText(total)).join(', ') : 'None'
}

function hostingUnits(pence: number) {
  return BigInt(pence) * UNIT / BigInt(100)
}

export default async function PeriodCostsPage({ searchParams }: { searchParams: { client?: string; from?: string; to?: string; project?: string } }) {
  await requireAuth()
  const today = new Date().toISOString().slice(0, 10)
  const clients = await prisma.client.findMany({ where: { isArchived: false }, orderBy: { name: 'asc' }, select: { id: true, name: true } })
  const requestedClient = (searchParams.client ?? '').trim()
  const client = requestedClient ? clients.find(item => item.id === requestedClient) ?? null : null
  const period = parseInclusivePeriod(searchParams.from, searchParams.to, today)
  const clientProjects = client ? await prisma.costProject.findMany({ where: { clientId: client.id, archived: false }, orderBy: { name: 'asc' }, select: { id: true, name: true } }) : []
  let report: ClientPeriodReport | null = null
  let error: string | null = requestedClient && !client ? 'That client is not available.' : null
  if (client && !error) {
    if (!period.ok) error = period.error
    else if (!clientProjects.length) error = `${client.name} has no linked projects. Link one under Projects & connections.`
    else {
      const projectId = clientProjects.some(project => project.id === searchParams.project) ? searchParams.project : undefined
      const loaded = await loadClientPeriod({ clientId: client.id, projectId, ...period.period })
      if ('error' in loaded) error = loaded.error
      else report = loaded
    }
  }
  const fromValue = searchParams.from || (period.ok ? period.period.from : '')
  const toValue = searchParams.to || (period.ok ? period.period.to : '')
  const projectValue = clientProjects.some(project => project.id === searchParams.project) ? searchParams.project! : ''

  return <div className="space-y-6 pb-10">
    <PageHeader title="Invoice period" description="Confirmed usage costs for one client’s projects between two dates. Nothing here is written onto an invoice." />
    <form className={`${panel} grid gap-4 md:grid-cols-2 xl:grid-cols-5 xl:items-end`} action="/costs/period">
      <label className="text-sm xl:col-span-2">Client<select className={inputClass} name="client" defaultValue={client?.id ?? ''} required><option value="">Choose a client</option>{clients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="text-sm">From (UTC)<input className={inputClass} type="date" name="from" defaultValue={fromValue} required /></label>
      <label className="text-sm">To (UTC, inclusive)<input className={inputClass} type="date" name="to" defaultValue={toValue} required /></label>
      <label className="text-sm">Project<select className={inputClass} name="project" defaultValue={projectValue}><option value="">All linked projects</option>{clientProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <button className={`${buttonClass} xl:col-span-5 xl:justify-self-start`}>Show costs</button>
    </form>
    {!client && !error && <p className={panel}>Choose the client on the invoice, then the dates the work covers. The project list appears after you choose a client.</p>}
    {error && <p className={`${panel} text-sm text-amber-900`} role="alert">{error}</p>}
    {client && report && <PeriodResult clientName={client.name} report={report} />}
  </div>
}

function PeriodResult({ clientName, report }: { clientName: string; report: ClientPeriodReport }) {
  const chargePlusHosting = report.totals.chargeGbp.units + hostingUnits(report.totals.hostingPence)
  const chargeKnown = report.totals.chargeGbp.known > 0 || report.totals.hostingPence > 0
  return <>
    <section aria-label="Period totals" className="grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
      {[
        ['Confirmed provider cost', gbpText(report.totals.confirmedGbp), 'On-demand and infrastructure cash of complete quality. Included subscription usage is not extra cash.'],
        ['Nominal usage', gbpText(report.totals.nominalGbp), 'Value of assigned Cursor usage, including work covered by a subscription.'],
        ['Provisional client charge', gbpText(report.totals.chargeGbp), 'Saved calculation rates on this usage. Not an invoice and not confirmed cash.'],
        ['Charge plus hosting', chargeKnown ? `${formatGbpUnits(chargePlusHosting)}${report.totals.chargeGbp.missing ? '*' : ''}` : 'None', report.totals.hostingDays ? `${formatCurrency(report.totals.hostingPence)} hosting over ${report.totals.hostingDays} days is included here only.` : 'No daily hosting fee falls in these dates.'],
      ].map(([label, amount, note]) => <div key={label} className="bg-white px-5 py-5"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-3 font-serif text-3xl tabular-nums text-slate-950">{amount}</p><p className="mt-2 text-xs leading-5 text-slate-500">{note}</p></div>)}
    </section>
    <section className={panel}>
      <h2 className="font-serif text-2xl">{clientName} · {report.from} to {report.to}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Only usage already assigned to these projects. Unassigned work is excluded. Dates are inclusive UTC days. An asterisk means some rows have no convertible amount. Amounts exclude VAT. {report.fxUnavailable ? 'A reference exchange rate was unavailable, so some GBP amounts are missing.' : 'GBP amounts use a recorded rate or an ECB reference, not a bank settlement rate.'}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="text-left text-slate-600"><th className="px-3 py-3">Project</th><th className="px-3 py-3 text-right">Events</th><th className="px-3 py-3 text-right">Held</th><th className="px-3 py-3 text-right">Confirmed provider cost</th><th className="px-3 py-3 text-right">Nominal usage</th><th className="px-3 py-3 text-right">Provisional client charge</th></tr></thead>
          <tbody>{report.projects.map(project => <ProjectRow key={project.projectId} project={project} />)}</tbody>
          <tfoot><tr className="border-t-2 border-slate-300 font-semibold"><th className="px-3 py-3 text-left">All listed projects</th><td className="px-3 py-3 text-right tabular-nums">{report.totals.events}</td><td className="px-3 py-3 text-right tabular-nums">{report.totals.held}</td><td className="px-3 py-3 text-right tabular-nums">{gbpText(report.totals.confirmedGbp)}</td><td className="px-3 py-3 text-right tabular-nums">{gbpText(report.totals.nominalGbp)}</td><td className="px-3 py-3 text-right tabular-nums">{gbpText(report.totals.chargeGbp)}</td></tr></tfoot>
        </table>
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">Held events stay in the event count and out of the provisional charge. <Link className="text-blue-700 underline" href="/costs/review">Review usage</Link> still holds anything without a project. <Link className="text-blue-700 underline" href="/costs/settings">Calculation setup</Link> changes the provisional charge, not the confirmed provider cost.</p>
    </section>
    {report.totals.hostingDays > 0 && <section className={panel}><h2 className="font-serif text-2xl">Daily hosting in this period</h2><p className="mt-2 text-sm leading-6 text-slate-600">Calculated from each project’s hosting dates and daily rate. This is not imported usage and not confirmed provider cash.</p><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[420px] text-sm"><thead><tr className="text-left text-slate-600"><th className="px-3 py-3">Project</th><th className="px-3 py-3 text-right">Days</th><th className="px-3 py-3 text-right">Fee ex VAT</th></tr></thead><tbody>{report.projects.filter(project => project.hostingDays > 0).map(project => <tr key={project.projectId} className="border-t border-slate-100"><td className="px-3 py-3"><Link className="text-blue-700 underline" href={`/costs/projects/${project.slug}`}>{project.name}</Link></td><td className="px-3 py-3 text-right tabular-nums">{project.hostingDays}</td><td className="px-3 py-3 text-right tabular-nums">{formatCurrency(project.hostingPence)}</td></tr>)}</tbody></table></div></section>}
  </>
}

function ProjectRow({ project }: { project: ClientPeriodProject }) {
  return <tr className="border-t border-slate-100">
    <th className="px-3 py-3 text-left font-medium"><Link className="text-blue-700 underline" href={`/costs/projects/${project.slug}`}>{project.name}</Link></th>
    <td className="px-3 py-3 text-right tabular-nums">{project.events}</td>
    <td className="px-3 py-3 text-right tabular-nums">{project.held || '—'}</td>
    <td className="px-3 py-3 text-right tabular-nums">{gbpText(project.confirmedGbp)}<span className="mt-1 block text-xs font-normal text-slate-500">{nativeLine(project.confirmed)}</span></td>
    <td className="px-3 py-3 text-right tabular-nums">{gbpText(project.nominalGbp)}<span className="mt-1 block text-xs font-normal text-slate-500">{nativeLine(project.nominal)}</span></td>
    <td className="px-3 py-3 text-right tabular-nums">{gbpText(project.chargeGbp)}<span className="mt-1 block text-xs font-normal text-slate-500">{nativeLine(project.charge)}</span></td>
  </tr>
}
