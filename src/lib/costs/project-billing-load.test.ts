import assert from 'node:assert/strict'
import test from 'node:test'
import { LEDGER_START } from './comparison-policy'
import { loadProjectBilling, loadProjectInvoiceGraph } from './project-billing-load'
import { chargeableBillingRows, isExplicitProviderInvoiceCoverage, isSyntheticMembershipSource, loadProjectSnapshot } from './project-snapshot-load'

const asOf = new Date('2026-10-10T12:00:00.000Z')
const policy = {
  id: 'policy', projectId: 'project-1', clientId: 'client-1', scopeKey: 'project-1', effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
  effectiveUntil: null, billable: true, includedBaseBps: 5000, markupBps: 0, infrastructureMarkupBps: 0, vercelDailyPence: 0, createdAt: asOf,
}

function revision(id: string, evidence: unknown = {}) {
  return { id, revision: 1, checksum: id, createdAt: asOf, funding: 'infrastructure', nominalUnits: null, providerUnits: BigInt(10_000_000), currency: 'GBP', quality: 'complete', fxGbp: null, evidence }
}

function event(id: string, sourceKey: string, occurredAt: string, provider = 'vercel', evidence?: unknown) {
  return { id, provider, accountRef: 'acct', sourceKey, occurredAt: new Date(occurredAt), model: null, revisions: [revision(id, evidence)] }
}

test('snapshot loader drops future events, synthetic membership, and explicit provider coverage before FX', async () => {
  let occurredAt: unknown
  let fxDates: string[] = []
  const loaded = await loadProjectSnapshot('itrader', { from: LEDGER_START, asOf }, {
    fx: async rows => {
      fxDates = rows.map(row => row.event.occurredAt.toISOString())
      return { quotes: rows.map(() => ({ currency: 'GBP', date: '2026-09-02', rate: '1', source: 'test' })), unavailable: false }
    },
    db: {
      costProject: { findUnique: async () => ({ id: 'project-1', slug: 'itrader', clientId: 'client-1', archived: false }) },
      costUsageEvent: { findMany: async args => { occurredAt = (args.where as { occurredAt?: unknown }).occurredAt; return [
        event('real', 'vercel:build:1', '2026-09-02T00:00:00.000Z', 'vercel', { resourceRef: 'same-host' }),
        event('member', 'vercel:membership:2026-09-02', '2026-09-02T01:00:00.000Z', 'vercel', { resourceRef: 'same-host' }),
        event('covered-bool', 'cursor:use:bool', '2026-09-02T02:00:00.000Z', 'cursor', { coveredByProviderInvoice: true, resourceRef: 'same-host' }),
        event('covered-text', 'cursor:use:text', '2026-09-02T03:00:00.000Z', 'cursor', { coveredByProviderInvoice: 'true' }),
        event('future', 'supabase:db:1', '2026-10-11T00:00:00.000Z', 'supabase'),
      ] } },
      costPolicy: { findMany: async () => [policy] },
      costImportRun: { findFirst: async () => null },
    },
  })
  assert.equal(loaded.ok, true)
  if (!loaded.ok) return
  assert.deepEqual(occurredAt, { gte: new Date(LEDGER_START), lte: asOf })
  assert.deepEqual(loaded.rows.map(row => row.event.id), ['real'])
  assert.deepEqual(fxDates, ['2026-09-02T00:00:00.000Z'])
  assert.ok(loaded.rows[0].fx)
  assert.equal(loaded.rows[0].fx.rate, '1')
  assert.equal(isSyntheticMembershipSource('vercel:membership:2026-09-02'), true)
  assert.equal(isExplicitProviderInvoiceCoverage({ coveredByProviderInvoice: true }), true)
  assert.equal(isExplicitProviderInvoiceCoverage({ coveredByProviderInvoice: 'true' }), true)
  assert.equal(isExplicitProviderInvoiceCoverage({ resourceRef: 'same-host' }), false)
  assert.deepEqual(chargeableBillingRows(loaded.rows).map(row => row.event.id), ['real'])
})

test('billing load reuses one snapshot and does not charge membership or covered provider usage', async () => {
  const calls = { events: 0, invoices: 0 }
  const invoice = {
    id: 'inv-1', invoiceNumber: 'MPD-2026-032', clientId: 'client-1', status: 'paid', issueDate: new Date('2026-05-27T00:00:00.000Z'),
    viewHidden: false, total: 50000, vatTotal: 0, creditNotes: [],
  }
  const db = {
    costProject: { findUnique: async () => ({ id: 'project-1', slug: 'itrader', clientId: 'client-1', archived: false }) },
    costUsageEvent: { findMany: async () => { calls.events += 1; return [
      event('real', 'vercel:build:1', '2026-09-02T00:00:00.000Z'),
      event('member', 'vercel:membership:2026-09-02', '2026-09-02T01:00:00.000Z'),
      event('covered', 'cursor:use:1', '2026-09-02T02:00:00.000Z', 'cursor', { coveredByProviderInvoice: 'true' }),
      event('future', 'supabase:db:1', '2026-10-11T00:00:00.000Z', 'supabase'),
    ] } },
    costPolicy: { findMany: async () => [policy] },
    costImportRun: { findFirst: async () => null },
    invoice: { findMany: async () => { calls.invoices += 1; return [invoice] } },
    invoiceCostAssociation: { findMany: async () => [{ invoiceId: 'inv-1', projectId: 'project-1' }] },
    costProjectMapping: { findMany: async () => [{ type: 'invoice-project', value: 'inv-1', projectId: 'project-1' }, { type: 'invoice-project', value: 'missing-row', projectId: 'project-1' }] },
  }
  const result = await loadProjectBilling('itrader', asOf, {
    db,
    fx: async rows => ({ quotes: rows.map(() => ({ currency: 'GBP', date: '2026-09-02', rate: '1', source: 'test' })), unavailable: false }),
  })
  assert.equal(calls.events, 1)
  assert.equal(result.status, 200)
  if (result.status !== 200 || !('costSnapshot' in result.body)) return
  assert.equal(result.body.costSnapshot.version, 'mpdee-project-cost-snapshot-v2')
  assert.equal(result.body.costSnapshot.coverage.from, LEDGER_START)
  assert.deepEqual(result.body.costSnapshot.lines.map(row => row.category), ['VERCEL_HOSTING'])
  assert.equal(result.body.costSnapshot.lines[0].events, 1)
  assert.equal(result.body.costSnapshot.lines[0].amountMinor, 100)
  assert.equal(result.body.costTotalPence, 100)
  assert.equal(result.body.invoiceTotals.issuedPence, 50000)
  assert.equal(result.body.invoiceTotals.invoiceCount, 1)
  assert.equal(result.body.coverage.invoicesBeforeCostLedger, 1)
  assert.equal(JSON.stringify(result.body).includes('MPD-2026-032'), false)
  assert.equal(result.report?.[0].invoiceNumber, 'MPD-2026-032')
  assert.equal(result.report?.some(row => row.invoiceId === 'missing-row'), false)
})

test('invoice graph keeps cross-project links and drops orphan mapping values', async () => {
  const invoices = [
    { id: 'inv-1', invoiceNumber: 'A', clientId: 'client-1', status: 'sent', issueDate: asOf, viewHidden: false, total: 100, vatTotal: 0, creditNotes: [] },
  ]
  const graph = await loadProjectInvoiceGraph({ id: 'project-1', clientId: 'client-1' }, {
    invoice: { findMany: async args => {
      const where = args.where as { id?: { in: string[] }; clientId?: string }
      if (where.id) return invoices.filter(row => where.id?.in.includes(row.id))
      return invoices
    } },
    invoiceCostAssociation: { findMany: async () => [{ invoiceId: 'inv-1', projectId: 'project-1' }] },
    costProjectMapping: { findMany: async args => {
      const where = args.where as { projectId?: string; value?: { in: string[] } }
      const rows = [{ type: 'invoice-project', value: 'missing-row', projectId: 'project-1' }, { type: 'invoice-project', value: 'inv-1', projectId: 'project-2' }, { type: 'workspace', value: 'inv-1', projectId: 'project-9' }]
      if (where.projectId) return rows.filter(row => row.projectId === where.projectId && row.type === 'invoice-project')
      return rows.filter(row => row.type === 'invoice-project' && where.value?.in.includes(row.value))
    } },
  })
  assert.deepEqual(graph.invoices.map(row => row.id), ['inv-1'])
  assert.deepEqual(graph.associations, [{ invoiceId: 'inv-1', projectId: 'project-1' }])
  assert.deepEqual(graph.mappings, [{ invoiceId: 'inv-1', projectId: 'project-2' }])
})
