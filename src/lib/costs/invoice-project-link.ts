export const INVOICE_PROJECT_MAPPING = 'invoice-project'
export const WHOLE_INVOICE_EX_VAT = 'whole-invoice-ex-vat'

const ISSUED = new Set(['sent', 'viewed', 'partial', 'paid', 'overdue', 'written_off'])
const ID = /^[A-Za-z0-9_-]{1,80}$/

export class InvoiceProjectLinkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceProjectLinkError'
  }
}

export type InvoiceProjectLinkInput = {
  invoiceId: string
  projectId: string
  reason: string
  actorId: string
  now: Date
}

type ProjectRow = { id: string; clientId: string | null; archived: boolean }
type InvoiceRow = {
  id: string
  clientId: string
  status: string
  issueDate: Date
  viewHidden: boolean
  total: number | null
  vatTotal: number | null
}
type AssociationRow = { invoiceId: string; projectId: string }
type MappingRow = { type: string; value: string; projectId: string }

export type InvoiceProjectLinkTx = {
  costProject: {
    findFirst: (args: { where: { id: string; archived: false }; select: { id: true; clientId: true; archived: true } }) => Promise<ProjectRow | null>
  }
  invoice: {
    findFirst: (args: { where: { id: string; viewHidden: false }; select: { id: true; clientId: true; status: true; issueDate: true; viewHidden: true; total: true; vatTotal: true } }) => Promise<InvoiceRow | null>
  }
  invoiceCostAssociation: {
    findUnique: (args: { where: { invoiceId: string }; select: { invoiceId: true; projectId: true } }) => Promise<AssociationRow | null>
  }
  costProjectMapping: {
    findUnique: (args: { where: { type_value: { type: string; value: string } } }) => Promise<MappingRow | null>
    create: (args: { data: { type: string; value: string; projectId: string } }) => Promise<MappingRow>
    update: (args: { where: { type_value: { type: string; value: string } }; data: { projectId: string } }) => Promise<MappingRow>
    delete: (args: { where: { type_value: { type: string; value: string } } }) => Promise<MappingRow>
  }
  auditLog: {
    create: (args: { data: { userId: string; action: string; entityType: string; entityId: string; details: string } }) => Promise<unknown>
  }
}

export type InvoiceProjectLinkResult =
  | { status: 'created' | 'updated' | 'unchanged' }
  | { status: 'removed' | 'absent'; servicePeriodRemains: boolean }

function fail(message: string): never {
  throw new InvoiceProjectLinkError(message)
}

function cleanId(value: string, label: string) {
  const id = value.trim()
  if (!ID.test(id)) fail(`Choose a valid ${label}.`)
  return id
}

function cleanReason(value: string) {
  const reason = value.trim()
  if (!reason || reason.length > 1000) fail('Add a brief explanation (up to 1,000 characters).')
  return reason
}

export function parseInvoiceProjectLinkInput(input: InvoiceProjectLinkInput) {
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) fail('The report clock is unavailable. Refresh and try again.')
  return {
    invoiceId: cleanId(input.invoiceId, 'invoice'),
    projectId: cleanId(input.projectId, 'project'),
    reason: cleanReason(input.reason),
    actorId: cleanId(input.actorId, 'account'),
    now: input.now,
  }
}

function exVatPence(invoice: InvoiceRow) {
  if (invoice.total === null || invoice.vatTotal === null) return null
  if (!Number.isSafeInteger(invoice.total) || !Number.isSafeInteger(invoice.vatTotal)) return null
  return invoice.total - invoice.vatTotal
}

function audit(tx: InvoiceProjectLinkTx, actorId: string, action: string, invoiceId: string, details: Record<string, unknown>) {
  return tx.auditLog.create({
    data: {
      userId: actorId,
      action,
      entityType: 'Invoice',
      entityId: invoiceId,
      details: JSON.stringify({ mode: WHOLE_INVOICE_EX_VAT, actorId, ...details }),
    },
  })
}

const mappingKey = (invoiceId: string) => ({ type_value: { type: INVOICE_PROJECT_MAPPING, value: invoiceId } })

async function activeProject(tx: InvoiceProjectLinkTx, projectId: string) {
  const project = await tx.costProject.findFirst({ where: { id: projectId, archived: false }, select: { id: true, clientId: true, archived: true } })
  if (!project || project.archived) fail('Choose an active project.')
  return project
}

async function visibleInvoice(tx: InvoiceProjectLinkTx, invoiceId: string) {
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, viewHidden: false },
    select: { id: true, clientId: true, status: true, issueDate: true, viewHidden: true, total: true, vatTotal: true },
  })
  if (!invoice || invoice.viewHidden) fail('Choose a visible issued invoice.')
  return invoice
}

function assertLinkable(invoice: InvoiceRow, project: ProjectRow, now: Date) {
  if (!project.clientId || invoice.clientId !== project.clientId) fail('The invoice client must match the project client.')
  if (!(invoice.issueDate instanceof Date) || !Number.isFinite(invoice.issueDate.getTime())) fail('Choose an invoice with a valid issue date.')
  if (invoice.issueDate.getTime() > now.getTime()) fail('Choose an invoice dated today or earlier.')
  if (!ISSUED.has(invoice.status)) fail('Choose an issued invoice. Drafts, cancelled and hidden invoices are excluded.')
}

export async function linkInvoiceToProject(tx: InvoiceProjectLinkTx, raw: InvoiceProjectLinkInput): Promise<InvoiceProjectLinkResult> {
  const input = parseInvoiceProjectLinkInput(raw)
  const project = await activeProject(tx, input.projectId)
  const invoice = await visibleInvoice(tx, input.invoiceId)
  assertLinkable(invoice, project, input.now)
  const association = await tx.invoiceCostAssociation.findUnique({ where: { invoiceId: input.invoiceId }, select: { invoiceId: true, projectId: true } })
  if (association && association.projectId !== input.projectId) {
    fail('This invoice already has a service-period association with another project. That association was left unchanged.')
  }
  const mapping = await tx.costProjectMapping.findUnique({ where: mappingKey(input.invoiceId) })
  if (mapping?.type && mapping.type !== INVOICE_PROJECT_MAPPING) fail('Could not save this invoice link. Refresh and try again.')
  if (mapping?.projectId === input.projectId) return { status: 'unchanged' }
  if (!mapping && association?.projectId === input.projectId) return { status: 'unchanged' }
  const before = mapping?.projectId ?? null
  if (mapping) await tx.costProjectMapping.update({ where: mappingKey(input.invoiceId), data: { projectId: input.projectId } })
  else await tx.costProjectMapping.create({ data: { type: INVOICE_PROJECT_MAPPING, value: input.invoiceId, projectId: input.projectId } })
  await audit(tx, input.actorId, mapping ? 'costs.invoice_project_link.update' : 'costs.invoice_project_link.create', input.invoiceId, {
    reason: input.reason,
    before: { projectId: before },
    after: { projectId: input.projectId },
    invoiceExVatPence: exVatPence(invoice),
  })
  return { status: mapping ? 'updated' : 'created' }
}

export async function unlinkInvoiceFromProject(tx: InvoiceProjectLinkTx, raw: InvoiceProjectLinkInput): Promise<InvoiceProjectLinkResult> {
  const input = parseInvoiceProjectLinkInput(raw)
  const mapping = await tx.costProjectMapping.findUnique({ where: mappingKey(input.invoiceId) })
  const association = await tx.invoiceCostAssociation.findUnique({ where: { invoiceId: input.invoiceId }, select: { invoiceId: true, projectId: true } })
  if (mapping && mapping.projectId !== input.projectId) fail('That project-only link belongs to another project and was left unchanged.')
  if (!mapping) return { status: 'absent', servicePeriodRemains: association?.projectId === input.projectId }
  await tx.costProjectMapping.delete({ where: mappingKey(input.invoiceId) })
  await audit(tx, input.actorId, 'costs.invoice_project_link.remove', input.invoiceId, {
    reason: input.reason,
    before: { projectId: mapping.projectId },
    after: { projectId: null },
    servicePeriodProjectId: association?.projectId ?? null,
  })
  return { status: 'removed', servicePeriodRemains: association?.projectId === input.projectId }
}
