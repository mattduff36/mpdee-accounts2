import { prisma } from '@/lib/db'
import { LEDGER_START } from './comparison-policy'
import { buildProjectBilling, type BillingInvoice, type BillingLink, type ProjectBillingEnvelope, type BillingReportDocument } from './project-billing'
import { buildLoadedProjectSnapshot, chargeableBillingRows, loadProjectSnapshot, type SnapshotLoadDeps } from './project-snapshot-load'

const invoiceSelect = {
  id: true,
  invoiceNumber: true,
  clientId: true,
  status: true,
  issueDate: true,
  viewHidden: true,
  total: true,
  vatTotal: true,
  creditNotes: { select: { id: true, creditNoteNumber: true, status: true, issueDate: true, total: true, vatTotal: true } },
} as const

type InvoiceRow = BillingInvoice & { invoiceNumber: string | null }

type BillingDb = NonNullable<SnapshotLoadDeps['db']> & {
  invoice: { findMany: (args: Record<string, unknown>) => Promise<InvoiceRow[]> }
  invoiceCostAssociation: { findMany: (args: Record<string, unknown>) => Promise<{ invoiceId: string; projectId: string }[]> }
  costProjectMapping: { findMany: (args: Record<string, unknown>) => Promise<{ type?: string; value: string; projectId: string }[]> }
}

export type ProjectBillingLoad = {
  status: 200 | 404 | 422
  body: ProjectBillingEnvelope | { error: string; limit?: number }
  report: BillingReportDocument[] | null
}

function invoiceProjectMappings(rows: { type?: string; value: string; projectId: string }[]): BillingLink[] {
  return rows.filter(row => (row.type === undefined || row.type === 'invoice-project') && row.value).map(row => ({ invoiceId: row.value, projectId: row.projectId }))
}

export async function loadProjectInvoiceGraph(project: { id: string; clientId: string | null }, db: Pick<BillingDb, 'invoice' | 'invoiceCostAssociation' | 'costProjectMapping'>) {
  const [directAssociations, directMappings, clientInvoices] = await Promise.all([
    db.invoiceCostAssociation.findMany({ where: { projectId: project.id }, select: { invoiceId: true, projectId: true } }),
    db.costProjectMapping.findMany({ where: { type: 'invoice-project', projectId: project.id }, select: { value: true, projectId: true } }),
    project.clientId ? db.invoice.findMany({ where: { clientId: project.clientId, viewHidden: false }, select: invoiceSelect }) : Promise.resolve([] as InvoiceRow[]),
  ])
  const known = new Map(clientInvoices.map(invoice => [invoice.id, invoice]))
  const wanted = new Set<string>([...directAssociations.map(link => link.invoiceId), ...directMappings.map(link => link.value), ...known.keys()])
  const missing = [...wanted].filter(id => !known.has(id))
  if (missing.length) {
    const extra = await db.invoice.findMany({ where: { id: { in: missing } }, select: invoiceSelect })
    for (const invoice of extra) known.set(invoice.id, invoice)
  }
  const ids = [...known.keys()]
  const [associations, mappings] = ids.length
    ? await Promise.all([
      db.invoiceCostAssociation.findMany({ where: { invoiceId: { in: ids } }, select: { invoiceId: true, projectId: true } }),
      db.costProjectMapping.findMany({ where: { type: 'invoice-project', value: { in: ids } }, select: { value: true, projectId: true } }),
    ])
    : [[], []]
  return {
    invoices: [...known.values()],
    associations: associations.filter(link => known.has(link.invoiceId)),
    mappings: invoiceProjectMappings(mappings).filter(link => known.has(link.invoiceId)),
  }
}

export async function loadProjectBilling(slug: string, asOf = new Date(), deps: SnapshotLoadDeps & { db?: BillingDb } = {}): Promise<ProjectBillingLoad> {
  const db = (deps.db ?? prisma) as BillingDb
  const loaded = await loadProjectSnapshot(slug, { from: LEDGER_START, asOf }, deps)
  if (!loaded.ok) return { status: loaded.status, body: loaded.limit ? { error: loaded.error, limit: loaded.limit } : { error: loaded.error }, report: null }
  const snapshot = buildLoadedProjectSnapshot({ ...loaded, rows: chargeableBillingRows(loaded.rows) })
  const graph = await loadProjectInvoiceGraph(loaded.project, db)
  const billing = buildProjectBilling({
    projectSlug: loaded.project.slug,
    projectId: loaded.project.id,
    clientId: loaded.project.clientId,
    asOf,
    snapshot,
    invoices: graph.invoices,
    associations: graph.associations,
    mappings: graph.mappings,
  })
  return { status: 200, body: billing.envelope, report: billing.report }
}
