import assert from 'node:assert/strict'
import test from 'node:test'
import { InvoiceProjectLinkError, linkInvoiceToProject, unlinkInvoiceFromProject, type InvoiceProjectLinkTx } from './invoice-project-link'

const now = new Date('2026-10-10T12:00:00.000Z')
const actor = 'user_admin_1'

type Project = { id: string; clientId: string | null; archived: boolean }
type Invoice = { id: string; clientId: string; status: string; issueDate: Date; viewHidden: boolean; total: number | null; vatTotal: number | null }
type Association = { invoiceId: string; projectId: string }
type Mapping = { type: string; value: string; projectId: string }
type Audit = { userId: string; action: string; entityType: string; entityId: string; details: string }

function harness(seed?: { projects?: Project[]; invoices?: Invoice[]; associations?: Association[]; mappings?: Mapping[] }) {
  const state = {
    projects: seed?.projects ?? [{ id: 'project_itrader', clientId: 'client_1', archived: false }],
    invoices: seed?.invoices ?? [{ id: 'invoice_1', clientId: 'client_1', status: 'sent', issueDate: new Date('2026-09-01T00:00:00.000Z'), viewHidden: false, total: 12000, vatTotal: 2000 }],
    associations: seed?.associations ?? [],
    mappings: seed?.mappings ?? [],
    audits: [] as Audit[],
    associationWrites: 0,
  }
  const tx: InvoiceProjectLinkTx = {
    costProject: { findFirst: async args => state.projects.find(project => project.id === args.where.id && project.archived === args.where.archived) ?? null },
    invoice: { findFirst: async args => state.invoices.find(invoice => invoice.id === args.where.id && invoice.viewHidden === args.where.viewHidden) ?? null },
    invoiceCostAssociation: {
      findUnique: async args => {
        state.associationWrites += 0
        return state.associations.find(row => row.invoiceId === args.where.invoiceId) ?? null
      },
    },
    costProjectMapping: {
      findUnique: async args => state.mappings.find(row => row.type === args.where.type_value.type && row.value === args.where.type_value.value) ?? null,
      create: async args => {
        const row = { ...args.data }
        state.mappings.push(row)
        return row
      },
      update: async args => {
        const row = state.mappings.find(item => item.type === args.where.type_value.type && item.value === args.where.type_value.value)
        if (!row) throw new Error('missing mapping')
        row.projectId = args.data.projectId
        return row
      },
      delete: async args => {
        const index = state.mappings.findIndex(item => item.type === args.where.type_value.type && item.value === args.where.type_value.value)
        if (index < 0) throw new Error('missing mapping')
        const [row] = state.mappings.splice(index, 1)
        return row
      },
    },
    auditLog: { create: async args => { state.audits.push(args.data); return args.data } },
  }
  const input = { invoiceId: 'invoice_1', projectId: 'project_itrader', reason: 'Whole invoice belongs to iTrader.', actorId: actor, now }
  return { state, tx, input }
}

function details(audit: Audit) {
  return JSON.parse(audit.details) as { mode: string; actorId: string; reason: string; before: { projectId: string | null }; after: { projectId: string | null } }
}

test('creates a project-only mapping and audits whole-invoice mode without touching service periods', async () => {
  const { state, tx, input } = harness()
  const result = await linkInvoiceToProject(tx, input)
  assert.deepEqual(result, { status: 'created' })
  assert.deepEqual(state.mappings, [{ type: 'invoice-project', value: 'invoice_1', projectId: 'project_itrader' }])
  assert.equal(state.associations.length, 0)
  assert.equal(state.audits.length, 1)
  assert.equal(state.audits[0].action, 'costs.invoice_project_link.create')
  assert.equal(state.audits[0].userId, actor)
  const body = details(state.audits[0])
  assert.equal(body.mode, 'whole-invoice-ex-vat')
  assert.equal(body.actorId, actor)
  assert.equal(body.reason, input.reason)
  assert.deepEqual(body.before, { projectId: null })
  assert.deepEqual(body.after, { projectId: 'project_itrader' })
  assert.equal(JSON.parse(state.audits[0].details).invoiceExVatPence, 10000)
})

test('repeated link to the same project-only mapping is idempotent', async () => {
  const { state, tx, input } = harness({ mappings: [{ type: 'invoice-project', value: 'invoice_1', projectId: 'project_itrader' }] })
  assert.deepEqual(await linkInvoiceToProject(tx, input), { status: 'unchanged' })
  assert.equal(state.audits.length, 0)
  assert.equal(state.mappings.length, 1)
})

test('same-project service period is idempotent and is not rewritten', async () => {
  const { state, tx, input } = harness({ associations: [{ invoiceId: 'invoice_1', projectId: 'project_itrader' }] })
  const before = state.associations[0]
  assert.deepEqual(await linkInvoiceToProject(tx, input), { status: 'unchanged' })
  assert.equal(state.associations[0], before)
  assert.equal(state.mappings.length, 0)
  assert.equal(state.audits.length, 0)
})

test('updates a project-only mapping when no association conflicts', async () => {
  const { state, tx, input } = harness({
    projects: [
      { id: 'project_itrader', clientId: 'client_1', archived: false },
      { id: 'project_other', clientId: 'client_1', archived: false },
    ],
    mappings: [{ type: 'invoice-project', value: 'invoice_1', projectId: 'project_other' }],
  })
  assert.deepEqual(await linkInvoiceToProject(tx, input), { status: 'updated' })
  assert.equal(state.mappings[0].projectId, 'project_itrader')
  assert.equal(state.audits[0].action, 'costs.invoice_project_link.update')
  assert.deepEqual(details(state.audits[0]).before, { projectId: 'project_other' })
  assert.deepEqual(details(state.audits[0]).after, { projectId: 'project_itrader' })
})

test('moves a conflicting project-only mapping onto the existing same-project service period', async () => {
  const { state, tx, input } = harness({
    associations: [{ invoiceId: 'invoice_1', projectId: 'project_itrader' }],
    mappings: [{ type: 'invoice-project', value: 'invoice_1', projectId: 'project_other' }],
  })
  assert.deepEqual(await linkInvoiceToProject(tx, input), { status: 'updated' })
  assert.equal(state.associations[0].projectId, 'project_itrader')
  assert.equal(state.mappings[0].projectId, 'project_itrader')
})

test('rejects a service-period association for another project without changing it', async () => {
  const { state, tx, input } = harness({
    associations: [{ invoiceId: 'invoice_1', projectId: 'project_other' }],
    mappings: [{ type: 'invoice-project', value: 'invoice_1', projectId: 'project_other' }],
  })
  await assert.rejects(linkInvoiceToProject(tx, input), (error: unknown) => error instanceof InvoiceProjectLinkError && /service-period association/.test(error.message))
  assert.equal(state.associations[0].projectId, 'project_other')
  assert.equal(state.mappings[0].projectId, 'project_other')
  assert.equal(state.audits.length, 0)
})

test('rejects archived, hidden, draft, future and wrong-client invoices', async () => {
  const cases: { name: string; mutate: (env: ReturnType<typeof harness>) => void; pattern: RegExp }[] = [
    { name: 'archived', mutate: env => { env.state.projects[0].archived = true }, pattern: /active project/ },
    { name: 'hidden', mutate: env => { env.state.invoices[0].viewHidden = true }, pattern: /visible issued/ },
    { name: 'draft', mutate: env => { env.state.invoices[0].status = 'draft' }, pattern: /issued invoice/ },
    { name: 'future', mutate: env => { env.state.invoices[0].issueDate = new Date('2026-10-11T00:00:00.000Z') }, pattern: /today or earlier/ },
    { name: 'client', mutate: env => { env.state.invoices[0].clientId = 'client_2' }, pattern: /client must match/ },
  ]
  for (const item of cases) {
    const env = harness()
    item.mutate(env)
    await assert.rejects(linkInvoiceToProject(env.tx, env.input), (error: unknown) => error instanceof InvoiceProjectLinkError && item.pattern.test(error.message), item.name)
    assert.equal(env.state.mappings.length, 0, item.name)
  }
})

test('rejects empty reason and form-supplied actor gaps', async () => {
  const env = harness()
  await assert.rejects(linkInvoiceToProject(env.tx, { ...env.input, reason: '  ' }), InvoiceProjectLinkError)
  await assert.rejects(linkInvoiceToProject(env.tx, { ...env.input, actorId: '' }), InvoiceProjectLinkError)
  assert.equal(env.state.mappings.length, 0)
})

test('removal deletes only the project-only mapping and reports a remaining service period', async () => {
  const { state, tx, input } = harness({
    associations: [{ invoiceId: 'invoice_1', projectId: 'project_itrader' }],
    mappings: [{ type: 'invoice-project', value: 'invoice_1', projectId: 'project_itrader' }],
  })
  const result = await unlinkInvoiceFromProject(tx, input)
  assert.deepEqual(result, { status: 'removed', servicePeriodRemains: true })
  assert.equal(state.mappings.length, 0)
  assert.equal(state.associations.length, 1)
  assert.equal(state.audits[0].action, 'costs.invoice_project_link.remove')
  assert.deepEqual(details(state.audits[0]).before, { projectId: 'project_itrader' })
  assert.deepEqual(details(state.audits[0]).after, { projectId: null })
  assert.equal(JSON.parse(state.audits[0].details).mode, 'whole-invoice-ex-vat')
})

test('removal of a missing mapping does not invent a delete', async () => {
  const { state, tx, input } = harness()
  assert.deepEqual(await unlinkInvoiceFromProject(tx, input), { status: 'absent', servicePeriodRemains: false })
  assert.equal(state.audits.length, 0)
})
