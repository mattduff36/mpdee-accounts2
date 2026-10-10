import Link from 'next/link'
import { formatCurrency, formatDate } from '@/lib/format'
import type { BillingReportDocument, ProjectBillingEnvelope } from '@/lib/costs/project-billing'
import { AnalysisForm } from './AnalysisForm'
import { removeInvoiceProjectLink, saveInvoiceProjectLink } from './billing-actions'
import { ProjectBillingChart } from './ProjectBillingChart'

const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
const reasons: Record<string, string> = {
  issued: 'Counted: whole issued invoice excluding VAT',
  'conflicting-project-links': 'Held: links point at more than one project',
  'wrong-client': 'Held: invoice client does not match the project',
  hidden: 'Excluded: hidden invoice',
  future: 'Excluded: issue date is after the report date',
  draft: 'Excluded: draft',
  cancelled: 'Excluded: cancelled',
  void: 'Excluded: void',
  'unknown-status': 'Held: status is not a known issued state',
  'incomplete-amount': 'Held: VAT or total is missing',
  'unknown-credit': 'Held: a credit note amount or status is unknown',
  'no-project-link': 'Eligible: no project link yet',
  'not-linked': 'Not counted',
}
const rank: Record<BillingReportDocument['disposition'], number> = { counted: 0, unlinked: 1, held: 2, excluded: 3 }

function gbp(pence: number | null) {
  return pence === null ? 'Unknown' : formatCurrency(pence)
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1 text-sm font-medium text-slate-700"><span>{label}</span>{children}</label>
}

export function ProjectBillingReport({
  projects, selected, requestedSlug, year, invoice, expense, writable, envelope, report, associations, mappings,
}: {
  projects: { id: string; name: string; slug: string; clientId: string | null }[]
  selected: { id: string; name: string; slug: string; clientId: string | null } | null
  requestedSlug: string
  year: number
  invoice?: string
  expense?: string
  writable: boolean
  envelope: ProjectBillingEnvelope | null
  report: BillingReportDocument[] | null
  associations: { invoiceId: string; projectId: string }[]
  mappings: { value: string; projectId: string }[]
}) {
  const documents = [...(report ?? [])].sort((a, b) => rank[a.disposition] - rank[b.disposition] || a.issueDate.localeCompare(b.issueDate))
  const unlinked = documents.filter(row => row.disposition === 'unlinked')
  const clientProjects = selected?.clientId ? projects.filter(project => project.clientId === selected.clientId) : []
  const months = new Map<string, ProjectBillingEnvelope['history'][number]>()
  for (const point of envelope?.history ?? []) months.set(point.day.slice(0, 7), point)
  const coverage = envelope?.coverage
  return <section id="project-billing" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <h2 className="text-lg font-semibold">Project costs and invoicing</h2>
    <p className="mt-1 text-sm text-slate-600">Compare recorded project costs with the full value of linked invoices, excluding VAT. This first version counts whole invoices; individual service and cost-recovery splits can be added later.</p>
    <form className="my-4 flex flex-col items-end gap-3 sm:flex-row">
      <input type="hidden" name="year" value={year} />
      {invoice ? <input type="hidden" name="invoice" value={invoice} /> : null}
      {expense ? <input type="hidden" name="expense" value={expense} /> : null}
      <div className="w-full"><Field label="Project"><select name="project" className={input} defaultValue={selected?.slug || ''}>{!selected && <option value="">Choose an active project</option>}{projects.map(project => <option key={project.id} value={project.slug}>{project.name}</option>)}</select></Field></div>
      <button className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 whitespace-nowrap">Show project</button>
    </form>
    {requestedSlug && !selected && <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">No active project matches “{requestedSlug}”.</p>}
    {!projects.length && <p className="text-sm text-slate-600">No active projects yet.</p>}
    {selected && !envelope && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Project costs for {selected.name} are unavailable. The recorded history may be missing or too large to summarise.</p>}
    {selected && envelope && <>
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
        <p>Whole-invoice amounts exclude recorded VAT. Linked history includes invoices issued before the cost ledger. Remaining to invoice is recorded costs minus net invoiced, not unpaid-invoice debt. If historical costs were never recorded, invoicing can exceed recorded costs; that difference is not a refund calculation.</p>
        <p className="mt-2">Report date {formatDate(envelope.asOf)}. Costs before {formatDate(coverage?.costLedgerStart)} are unknown, not zero.</p>
      </div>
      {(coverage?.costsPartial || coverage?.unlinkedInvoiceCount || coverage?.conflictingInvoiceCount || coverage?.invoicesBeforeCostLedger) ? <ul className="mt-4 space-y-2 text-sm text-amber-950">
        {coverage.costsPartial && <li className="rounded-lg bg-amber-50 p-3">Recorded costs are partial or include held lines. <Link className="font-medium underline" href={`/costs/issues?project=${encodeURIComponent(selected.slug)}`}>Review cost issues</Link> before treating the balance as complete.</li>}
        {coverage.unlinkedInvoiceCount > 0 && <li className="rounded-lg bg-amber-50 p-3">{coverage.unlinkedInvoiceCount} visible issued invoice{coverage.unlinkedInvoiceCount === 1 ? '' : 's'} for this client {coverage.unlinkedInvoiceCount === 1 ? 'is' : 'are'} not linked. <a className="font-medium underline" href="#project-billing-link">Link a whole invoice</a> or <Link className="font-medium underline" href="#invoice-links">confirm a service period</Link>.</li>}
        {coverage.conflictingInvoiceCount > 0 && <li className="rounded-lg bg-amber-50 p-3">{coverage.conflictingInvoiceCount} invoice{coverage.conflictingInvoiceCount === 1 ? '' : 's'} need review because their links or document details are incomplete. Remaining to invoice is unknown until they are resolved. <Link className="font-medium underline" href="#invoice-links">Review service periods</Link>.</li>}
        {coverage.invoicesBeforeCostLedger > 0 && <li className="rounded-lg bg-amber-50 p-3">{coverage.invoicesBeforeCostLedger} counted invoice{coverage.invoicesBeforeCostLedger === 1 ? '' : 's'} predate the cost ledger, so invoicing can exceed recorded costs.</li>}
      </ul> : null}
      <dl className="mt-4 grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
        {[['Recorded project costs', envelope.costTotalPence], ['Net invoiced', envelope.invoiceTotals.netInvoicedPence], ['Remaining to invoice', envelope.remainingToInvoicePence], ['Credit notes', envelope.invoiceTotals.creditPence]].map(([label, value]) => <div key={String(label)} className="bg-white p-5"><dt className="text-sm text-slate-600">{label}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{gbp(value as number | null)}</dd></div>)}
      </dl>
      <p className="mt-3 text-sm text-slate-600">{envelope.invoiceTotals.invoiceCount} counted invoice{envelope.invoiceTotals.invoiceCount === 1 ? '' : 's'} · {envelope.invoiceTotals.creditCount} counted credit note{envelope.invoiceTotals.creditCount === 1 ? '' : 's'} · issued {gbp(envelope.invoiceTotals.issuedPence)} less credits {gbp(envelope.invoiceTotals.creditPence)}.</p>
      <div className="mt-5"><ProjectBillingChart history={envelope.history} /></div>
      <details className="mt-4" open>
        <summary className="cursor-pointer text-sm font-medium text-blue-700">Monthly cumulative figures</summary>
        <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><caption className="sr-only">Month-end cumulative costs, net invoiced and remaining for {selected.name}</caption><thead><tr className="text-left text-slate-600"><th className="py-2">Month</th><th>Recorded costs</th><th>Net invoiced</th><th>Remaining</th></tr></thead><tbody>{[...months.entries()].map(([month, point]) => <tr key={month} className="border-t border-slate-100"><th className="py-2 text-left font-medium">{month}</th><td>{gbp(point.costPence)}</td><td>{gbp(point.invoicedPence)}</td><td>{gbp(point.remainingToInvoicePence)}</td></tr>)}</tbody></table></div>
      </details>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-blue-700">Daily cumulative figures</summary>
        <div className="mt-3 max-h-80 overflow-auto"><table className="w-full min-w-[640px] text-sm"><caption className="sr-only">Daily cumulative costs, net invoiced and remaining for {selected.name}</caption><thead><tr className="text-left text-slate-600"><th className="py-2">Day</th><th>Recorded costs</th><th>Net invoiced</th><th>Remaining</th></tr></thead><tbody>{envelope.history.map(point => <tr key={point.day} className="border-t border-slate-100"><th className="py-2 text-left font-medium">{point.day}</th><td>{gbp(point.costPence)}</td><td>{gbp(point.invoicedPence)}</td><td>{gbp(point.remainingToInvoicePence)}</td></tr>)}</tbody></table></div>
      </details>
      <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><caption className="mb-2 text-left font-medium text-slate-800">Invoices and credit notes considered for {selected.name}</caption><thead><tr className="text-left text-slate-600"><th className="py-2">Document</th><th>Status</th><th>Date</th><th>Treatment</th><th>Ex VAT</th></tr></thead><tbody>{documents.map(row => {
        const association = associations.find(item => item.invoiceId === row.invoiceId)
        const mapping = mappings.find(item => item.value === row.invoiceId && item.projectId === selected.id)
        const otherMapping = mappings.find(item => item.value === row.invoiceId && item.projectId !== selected.id)
        return <tr key={row.invoiceId} className="border-t border-slate-100 align-top"><td className="py-3 pr-3"><Link className="font-medium text-blue-700 underline" href={`/invoices/${row.invoiceId}`}>{row.invoiceNumber || 'Invoice'}</Link>{row.credits.map(credit => <div key={credit.creditNoteId} className="mt-1 text-slate-600">{credit.creditNoteNumber || 'Credit note'} · {formatDate(credit.issueDate)} · {gbp(credit.exVatPence)}{credit.counted ? '' : ' · not counted'}</div>)}</td><td>{row.status}</td><td>{formatDate(row.issueDate)}</td><td>{reasons[row.reason] || row.reason}{association ? ' · service period on file' : ''}{mapping ? ' · project-only link' : ''}{otherMapping ? ' · project-only link on another project' : ''}{writable && mapping && <div className="mt-3 max-w-sm"><p className="mb-2 text-xs text-slate-600">{association?.projectId === selected.id ? 'Removing the project-only link leaves the service period in place, so this invoice still counts.' : association ? 'Removing the project-only link does not move or delete the service-period association.' : 'Removing the project-only link stops this whole invoice counting here. There is no service period to remove.'}</p><AnalysisForm action={removeInvoiceProjectLink} label="Remove project-only link"><input type="hidden" name="invoiceId" value={row.invoiceId} /><input type="hidden" name="projectId" value={selected.id} /><Field label="Reason for removal"><input required name="reason" maxLength={1000} className={input} /></Field></AnalysisForm></div>}</td><td>{row.disposition === 'counted' ? gbp(row.exVatPence) : 'Not counted'}</td></tr>
      })}</tbody></table></div>
      {!documents.length && <p className="mt-3 text-sm text-slate-600">No invoices are counted, held or waiting to be linked for this project.</p>}
      <div id="project-billing-link" className="mt-6 scroll-mt-6 border-t border-slate-100 pt-4">
        <h3 className="font-medium">Link a whole invoice to this project</h3>
        <p className="mt-1 text-sm text-slate-600">Attach an issued invoice using its full amount excluding VAT. Service dates are optional for this project balance; use the form below when you also want to allocate costs to a confirmed service period.</p>
        {writable && unlinked.length > 0 && clientProjects.length > 0 && <div className="mt-3"><AnalysisForm action={saveInvoiceProjectLink} label="Save project-only link"><div className="grid gap-3 sm:grid-cols-2"><Field label="Invoice"><select required name="invoiceId" className={input} defaultValue=""><option value="">Choose an unlinked invoice</option>{unlinked.map(row => <option key={row.invoiceId} value={row.invoiceId}>{row.invoiceNumber || 'Invoice'} · {formatDate(row.issueDate)} · {row.status}</option>)}</select></Field><Field label="Project"><select required name="projectId" className={input} defaultValue={selected.id}>{clientProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field></div><Field label="Evidence / reason"><input required name="reason" maxLength={1000} className={input} /></Field></AnalysisForm></div>}
        {writable && !selected.clientId && <p className="mt-3 text-sm text-amber-800">Link {selected.name} to a client in <Link className="underline" href="/costs/projects">Projects & rates</Link> before attaching invoices.</p>}
        {writable && selected.clientId && !unlinked.length && <p className="mt-3 text-sm text-slate-600">No eligible unlinked issued invoices for this client.</p>}
        {!writable && <p className="mt-3 text-sm text-slate-600">Invoice links can be changed by an administrator.</p>}
      </div>
    </>}
  </section>
}
