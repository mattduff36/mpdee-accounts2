import assert from 'node:assert/strict'
import test from 'node:test'
import { LEDGER_START } from './comparison-policy'
import { buildProjectBilling, type BillingInvoice, type BillingSnapshot } from './project-billing'

const asOf = new Date('2026-10-10T12:00:00.000Z')
const clientId = 'client-itrader'
const projectId = 'project-itrader'

function line(periodStart: string, amountMinor: number | null, extras: { held?: boolean; category?: BillingSnapshot['lines'][number]['category'] } = {}) {
  return {
    id: periodStart + String(amountMinor), revision: 'r', category: extras.category ?? 'VERCEL_HOSTING', label: 'Vercel hosting',
    periodStart, periodEnd: periodStart, amountMinor, currency: 'GBP' as const, provisional: true as const, held: extras.held ?? false,
    funding: 'infrastructure', events: 1, sourceCurrency: 'GBP', sourceUnits: '1', fx: [],
  }
}

function snapshot(lines: ReturnType<typeof line>[], coverage: Partial<BillingSnapshot['coverage']> = {}): BillingSnapshot {
  return {
    version: 'mpdee-project-cost-snapshot-v2', project: 'itrader', approvedSnapshot: false, asOf: asOf.toISOString(), revision: 'snap',
    sourceUpdatedAt: null, coverage: { events: lines.length, held: lines.filter(row => row.held).length, fxMissing: 0, from: LEDGER_START, ...coverage }, lines,
  } as BillingSnapshot
}

function invoice(partial: Partial<BillingInvoice> & Pick<BillingInvoice, 'id' | 'status' | 'issueDate'>): BillingInvoice {
  return {
    clientId, viewHidden: false, total: 12000, vatTotal: 2000, subtotal: 10000, discountTotal: 0, amountPaid: 99999, balanceDue: 1,
    invoiceNumber: partial.invoiceNumber ?? null, creditNotes: [], ...partial,
  }
}

function bill(input: { invoices?: BillingInvoice[]; associations?: { invoiceId: string; projectId: string }[]; mappings?: { invoiceId: string; projectId: string }[]; lines?: ReturnType<typeof line>[]; when?: Date; client?: string | null }) {
  return buildProjectBilling({
    projectSlug: 'itrader', projectId, clientId: input.client === undefined ? clientId : input.client, asOf: input.when ?? asOf,
    snapshot: snapshot(input.lines ?? [line('2026-08-14', 100)]), invoices: input.invoices ?? [], associations: input.associations ?? [], mappings: input.mappings ?? [],
  })
}

test('whole invoice ex-VAT ignores discounts, payments and VAT, and preserves a negative balance', () => {
  const discounted = invoice({ id: 'disc', status: 'paid', issueDate: new Date('2026-09-01T00:00:00.000Z'), subtotal: 10000, discountTotal: 2000, vatTotal: 1600, total: 9600, amountPaid: 9600, balanceDue: 0 })
  const result = bill({ invoices: [discounted], associations: [{ invoiceId: 'disc', projectId }] })
  assert.equal(result.envelope.invoiceTotals.issuedPence, 8000)
  assert.equal(result.envelope.invoiceTotals.netInvoicedPence, 8000)
  assert.equal(result.envelope.remainingToInvoicePence, 100 - 8000)
  assert.ok((result.envelope.remainingToInvoicePence ?? 0) < 0)
  assert.equal(JSON.stringify(result.envelope).includes('99999'), false)
})

test('issued statuses count, drafts cancelled void hidden and future documents do not, and unknown status is held', () => {
  const statuses = ['sent', 'viewed', 'partial', 'paid', 'overdue', 'written_off', 'draft', 'cancelled', 'void', 'mystery']
  const invoices = statuses.map(status => invoice({ id: status, status, issueDate: new Date('2026-09-02T00:00:00.000Z'), total: 1000, vatTotal: 0, amountPaid: status === 'paid' ? 1000 : 0 }))
  invoices.push(invoice({ id: 'hidden', status: 'sent', viewHidden: true, issueDate: new Date('2026-09-02T00:00:00.000Z'), total: 5000, vatTotal: 0 }))
  invoices.push(invoice({ id: 'future', status: 'sent', issueDate: new Date('2026-10-10T12:00:00.001Z'), total: 7000, vatTotal: 0 }))
  const result = bill({ invoices, associations: invoices.map(row => ({ invoiceId: row.id, projectId })) })
  assert.equal(result.envelope.invoiceTotals.invoiceCount, 6)
  assert.equal(result.envelope.invoiceTotals.issuedPence, 6000)
  assert.equal(result.envelope.coverage.conflictingInvoiceCount, 1)
  assert.equal(result.envelope.remainingToInvoicePence, null)
  assert.equal(result.report.find(row => row.invoiceId === 'mystery')?.reason, 'unknown-status')
  assert.equal(result.report.find(row => row.invoiceId === 'paid')?.exVatPence, 1000)
})

test('authorised historical invoices total 95000p, two fall before the cost ledger, and history ends on asOf', () => {
  const invoices = [
    invoice({ id: 'i32', invoiceNumber: 'MPD-2026-032', status: 'paid', issueDate: new Date('2026-05-27T00:00:00.000Z'), total: 50000, vatTotal: 0 }),
    invoice({ id: 'i45', invoiceNumber: 'MPD-2026-045', status: 'sent', issueDate: new Date('2026-08-08T00:00:00.000Z'), total: 20000, vatTotal: 0 }),
    invoice({ id: 'i56', invoiceNumber: 'MPD-2026-056', status: 'sent', issueDate: new Date('2026-10-04T00:00:00.000Z'), total: 25000, vatTotal: 0 }),
  ]
  const result = bill({ invoices, associations: invoices.map(row => ({ invoiceId: row.id, projectId })), mappings: [{ invoiceId: 'i32', projectId }] })
  assert.equal(result.envelope.invoiceTotals.issuedPence, 95000)
  assert.equal(result.envelope.invoiceTotals.invoiceCount, 3)
  assert.equal(result.envelope.coverage.invoicesBeforeCostLedger, 2)
  assert.equal(result.envelope.coverage.costLedgerStart, LEDGER_START)
  const history = result.envelope.history
  assert.equal(history[0].day, '2026-05-27')
  assert.equal(history.at(-1)?.day, '2026-10-10')
  assert.equal(history.length, (Date.parse('2026-10-10T00:00:00.000Z') - Date.parse('2026-05-27T00:00:00.000Z')) / 86400000 + 1)
  assert.equal(history[0].invoicedPence, 50000)
  assert.equal(history[0].costPence, null)
  assert.equal(history.find(day => day.day === '2026-08-08')?.invoicedPence, 70000)
  assert.equal(history.find(day => day.day === '2026-08-13')?.costPence, 0)
  assert.equal(history.find(day => day.day === '2026-08-14')?.costPence, 100)
  assert.equal(history.at(-1)?.invoicedPence, result.envelope.invoiceTotals.netInvoicedPence)
  assert.equal(history.at(-1)?.costPence, result.envelope.costTotalPence)
  assert.equal(history.at(-1)?.remainingToInvoicePence, result.envelope.remainingToInvoicePence)
  assert.equal(result.envelope.remainingToInvoicePence, 100 - 95000)
  assert.equal(JSON.stringify(result.envelope).includes('MPD-2026'), false)
  assert.equal(result.report.find(row => row.invoiceId === 'i32')?.invoiceNumber, 'MPD-2026-032')
  assert.equal(result.report.find(row => row.invoiceId === 'i32')?.status, 'paid')
  assert.equal(result.report.find(row => row.invoiceId === 'i32')?.issueDate, '2026-05-27T00:00:00.000Z')
  assert.equal(JSON.stringify(result.envelope).includes('2026-05-27T00:00:00.000Z'), false)
  assert.equal(JSON.stringify(result.envelope).includes('"status"'), false)
})

test('credits reduce net invoiced on the credit date and do not use amount applied', () => {
  const issued = invoice({
    id: 'inv', status: 'partial', issueDate: new Date('2026-09-01T00:00:00.000Z'), total: 12000, vatTotal: 2000,
    creditNotes: [
      { id: 'draft', status: 'draft', issueDate: new Date('2026-09-02T00:00:00.000Z'), total: 100, vatTotal: 0, amountApplied: 100 },
      { id: 'credit', creditNoteNumber: 'CN-1', status: 'open', issueDate: new Date('2026-09-05T00:00:00.000Z'), total: 2400, vatTotal: 400, amountApplied: 0 },
      { id: 'later', status: 'issued', issueDate: new Date('2026-10-11T00:00:00.000Z'), total: 1000, vatTotal: 0 },
      { id: 'void', status: 'void', issueDate: new Date('2026-09-06T00:00:00.000Z'), total: 1000, vatTotal: 0 },
    ],
  })
  const result = bill({ invoices: [issued], associations: [{ invoiceId: 'inv', projectId }] })
  assert.equal(result.envelope.invoiceTotals.issuedPence, 10000)
  assert.equal(result.envelope.invoiceTotals.creditPence, 2000)
  assert.equal(result.envelope.invoiceTotals.creditCount, 1)
  assert.equal(result.envelope.invoiceTotals.netInvoicedPence, 8000)
  const before = result.envelope.history.find(day => day.day === '2026-09-04')
  const onCredit = result.envelope.history.find(day => day.day === '2026-09-05')
  assert.equal(before?.invoicedPence, 10000)
  assert.equal(onCredit?.invoicedPence, 8000)
  assert.equal(JSON.stringify(result.envelope).includes('CN-1'), false)
})

test('same-project links dedupe, conflicting and wrong-client links are held, and orphan mappings are not invoices', () => {
  const shared = invoice({ id: 'shared', status: 'sent', issueDate: new Date('2026-09-01T00:00:00.000Z'), total: 3000, vatTotal: 0 })
  const conflict = invoice({ id: 'conflict', status: 'sent', issueDate: new Date('2026-09-01T00:00:00.000Z'), total: 4000, vatTotal: 0 })
  const otherClient = invoice({ id: 'other', clientId: 'someone-else', status: 'paid', issueDate: new Date('2026-09-01T00:00:00.000Z'), total: 8000, vatTotal: 0 })
  const unlinked = invoice({ id: 'loose', status: 'overdue', issueDate: new Date('2026-09-03T00:00:00.000Z'), total: 50, vatTotal: 0 })
  const draft = invoice({ id: 'draft', status: 'draft', issueDate: new Date('2026-09-03T00:00:00.000Z'), total: 50, vatTotal: 0 })
  const result = bill({
    invoices: [shared, conflict, otherClient, unlinked, draft, shared],
    associations: [{ invoiceId: 'shared', projectId }, { invoiceId: 'conflict', projectId }, { invoiceId: 'other', projectId }],
    mappings: [{ invoiceId: 'shared', projectId }, { invoiceId: 'conflict', projectId: 'other-project' }, { invoiceId: 'missing-invoice', projectId }],
  })
  assert.equal(result.envelope.invoiceTotals.invoiceCount, 1)
  assert.equal(result.envelope.invoiceTotals.issuedPence, 3000)
  assert.equal(result.envelope.coverage.conflictingInvoiceCount, 2)
  assert.equal(result.envelope.coverage.unlinkedInvoiceCount, 1)
  assert.equal(result.envelope.remainingToInvoicePence, null)
  assert.equal(result.report.some(row => row.invoiceId === 'missing-invoice'), false)
  assert.equal(result.report.find(row => row.invoiceId === 'other')?.reason, 'wrong-client')
})

test('links that never name this project are ignored, including conflicts between other projects', () => {
  const elsewhere = invoice({ id: 'elsewhere', status: 'sent', issueDate: new Date('2026-09-01T00:00:00.000Z'), total: 9000, vatTotal: 0 })
  const result = bill({
    lines: [line('2026-09-01', 100, { category: 'CURSOR' })],
    invoices: [elsewhere],
    associations: [{ invoiceId: 'elsewhere', projectId: 'other-a' }],
    mappings: [{ invoiceId: 'elsewhere', projectId: 'other-b' }],
  })
  assert.equal(result.envelope.remainingToInvoicePence, 100)
  assert.equal(result.envelope.coverage.conflictingInvoiceCount, 0)
  assert.equal(result.envelope.coverage.costsPartial, false)
  assert.equal(result.envelope.invoiceTotals.invoiceCount, 0)
  assert.equal(result.report.some(row => row.invoiceId === 'elsewhere'), false)
})

test('zero costs stay zero, unknown and held costs stay null or partial, and daily pence are not repriced', () => {
  const zero = bill({ lines: [line('2026-08-14', 0)], invoices: [] })
  assert.equal(zero.envelope.costTotalPence, 0)
  assert.equal(zero.envelope.coverage.costsPartial, false)
  assert.equal(zero.envelope.remainingToInvoicePence, 0)
  const unknown = bill({ lines: [] })
  assert.equal(unknown.envelope.costTotalPence, null)
  assert.equal(unknown.envelope.remainingToInvoicePence, null)
  assert.equal(unknown.envelope.coverage.costsPartial, true)
  const held = bill({ lines: [line('2026-08-14', null, { held: true }), line('2026-08-15', 40)] })
  assert.equal(held.envelope.costTotalPence, 40)
  assert.equal(held.envelope.coverage.costsPartial, true)
  assert.equal(held.envelope.history.find(day => day.day === '2026-08-15')?.costPence, 40)
  const missingFx = bill({ lines: [line('2026-08-14', null), line('2026-08-14', 0, { category: 'DATABASE' })] })
  assert.equal(missingFx.envelope.costTotalPence, 0)
  assert.equal(missingFx.envelope.coverage.costsPartial, true)
  const cursorOnly = bill({ lines: [line('2026-09-01', 100, { category: 'CURSOR' })] })
  assert.equal(cursorOnly.envelope.costTotalPence, 100)
  assert.equal(cursorOnly.envelope.coverage.costsPartial, false)
  assert.equal(cursorOnly.envelope.remainingToInvoicePence, 100)
})

test('null amounts are held, overflow throws, revision is deterministic, and history is capped at ten years', () => {
  const missing = invoice({ id: 'null', status: 'sent', issueDate: new Date('2026-09-01T00:00:00.000Z'), total: null, vatTotal: 200 })
  const held = bill({ invoices: [missing], associations: [{ invoiceId: 'null', projectId }] })
  assert.equal(held.envelope.invoiceTotals.issuedPence, 0)
  assert.equal(held.envelope.remainingToInvoicePence, null)
  assert.equal(held.report[0].reason, 'incomplete-amount')
  assert.throws(() => bill({ lines: [line('2026-08-14', Number.MAX_SAFE_INTEGER), line('2026-08-15', Number.MAX_SAFE_INTEGER)] }), /safe integer/)
  const old = invoice({ id: 'old', status: 'sent', issueDate: new Date('2000-01-01T00:00:00.000Z'), total: 100, vatTotal: 0 })
  const first = bill({ invoices: [old], associations: [{ invoiceId: 'old', projectId }] })
  const second = bill({ invoices: [old, old], mappings: [{ invoiceId: 'old', projectId }], associations: [{ invoiceId: 'old', projectId }] })
  assert.equal(first.envelope.revision, second.envelope.revision)
  assert.equal(first.envelope.history.length, 3661)
  assert.equal(first.envelope.history[0].invoicedPence, 100)
  assert.equal(first.envelope.history.at(-1)?.invoicedPence, 100)
  assert.equal(first.envelope.costSnapshot, first.envelope.costSnapshot)
  assert.equal(first.envelope.allocationMode, 'whole-invoice-ex-vat')
  assert.equal(first.envelope.balanceBasis, 'costs-minus-invoices')
})
