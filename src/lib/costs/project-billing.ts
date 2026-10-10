import { createHash } from 'node:crypto'
import { LEDGER_START } from './comparison-policy'
import type { projectSnapshot } from './project-snapshot'

const ISSUED_INVOICE = new Set(['sent', 'viewed', 'partial', 'paid', 'overdue', 'written_off'])
const EXCLUDED_INVOICE = new Set(['draft', 'cancelled', 'void'])
const ISSUED_CREDIT = new Set(['open', 'issued', 'applied', 'partial', 'paid'])
const EXCLUDED_CREDIT = new Set(['draft', 'cancelled', 'void'])
const HISTORY_SPAN_DAYS = 3660
const LEDGER_DAY = LEDGER_START.slice(0, 10)

export type BillingCredit = {
  id: string
  creditNoteNumber?: string | null
  status: string
  issueDate: Date
  total: number | null
  vatTotal: number | null
  /** Ignored. Applied cash does not change the document total. */
  amountApplied?: number | null
}

export type BillingInvoice = {
  id: string
  invoiceNumber?: string | null
  clientId: string
  status: string
  issueDate: Date
  viewHidden: boolean
  total: number | null
  vatTotal: number | null
  /** Ignored. Discounts are already inside total. */
  subtotal?: number | null
  discountTotal?: number | null
  /** Ignored. Payments do not change costs-minus-invoices. */
  amountPaid?: number | null
  balanceDue?: number | null
  creditNotes: BillingCredit[]
}

export type BillingLink = { invoiceId: string; projectId: string }

export type BillingSnapshot = ReturnType<typeof projectSnapshot>

export type BillingReportCredit = {
  creditNoteId: string
  creditNoteNumber: string | null
  issueDate: string
  exVatPence: number | null
  counted: boolean
}

export type BillingReportDocument = {
  invoiceId: string
  invoiceNumber: string | null
  clientId: string
  status: string
  issueDate: string
  disposition: 'counted' | 'excluded' | 'held' | 'unlinked'
  reason: string
  exVatPence: number | null
  credits: BillingReportCredit[]
}

export type ProjectBillingEnvelope = {
  version: 'mpdee-project-billing-v1'
  project: string
  currency: 'GBP'
  allocationMode: 'whole-invoice-ex-vat'
  balanceBasis: 'costs-minus-invoices'
  asOf: string
  revision: string
  costSnapshot: BillingSnapshot
  costTotalPence: number | null
  invoiceTotals: {
    issuedPence: number
    creditPence: number
    netInvoicedPence: number
    invoiceCount: number
    creditCount: number
  }
  remainingToInvoicePence: number | null
  coverage: {
    unlinkedInvoiceCount: number
    conflictingInvoiceCount: number
    costsPartial: boolean
    costLedgerStart: typeof LEDGER_START
    invoicesBeforeCostLedger: number
  }
  history: { day: string; costPence: number | null; invoicedPence: number; remainingToInvoicePence: number | null }[]
}

type CountedInvoice = {
  invoice: BillingInvoice
  exVat: bigint
  credits: { credit: BillingCredit; exVat: bigint }[]
}

type Classified = {
  invoice: BillingInvoice
  disposition: BillingReportDocument['disposition']
  reason: string
  exVat: bigint | null
  credits: { credit: BillingCredit; exVat: bigint | null; counted: boolean }[]
}

function safe(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('Billing amount exceeds safe integer range')
  return Number(value)
}

function exVat(total: number | null, vatTotal: number | null) {
  if (total === null || vatTotal === null) return null
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(vatTotal)) throw new Error('Billing amount exceeds safe integer range')
  return BigInt(total) - BigInt(vatTotal)
}

function dayOf(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10)
}

function enumerateDays(start: string, end: string) {
  const days: string[] = []
  let cursor = Date.parse(`${start}T00:00:00.000Z`)
  const last = Date.parse(`${end}T00:00:00.000Z`)
  while (cursor <= last && days.length <= HISTORY_SPAN_DAYS) {
    days.push(new Date(cursor).toISOString().slice(0, 10))
    cursor += 86400000
  }
  return days
}

function classifyInvoice(invoice: BillingInvoice, projectId: string, clientId: string | null, targets: Set<string>, asOfMs: number): Classified {
  const credits = invoice.creditNotes.map(credit => ({ credit, exVat: exVat(credit.total, credit.vatTotal), counted: false }))
  const base = { invoice, exVat: exVat(invoice.total, invoice.vatTotal), credits }
  if (targets.size > 1) return { ...base, disposition: 'held', reason: 'conflicting-project-links' }
  if (targets.size === 1) {
    if (!clientId || invoice.clientId !== clientId) return { ...base, disposition: 'held', reason: 'wrong-client' }
    if (invoice.viewHidden) return { ...base, disposition: 'excluded', reason: 'hidden' }
    if (invoice.issueDate.getTime() > asOfMs) return { ...base, disposition: 'excluded', reason: 'future' }
    if (EXCLUDED_INVOICE.has(invoice.status)) return { ...base, disposition: 'excluded', reason: invoice.status }
    if (!ISSUED_INVOICE.has(invoice.status)) return { ...base, disposition: 'held', reason: 'unknown-status' }
    if (base.exVat === null) return { ...base, disposition: 'held', reason: 'incomplete-amount' }
    for (const credit of credits) {
      if (EXCLUDED_CREDIT.has(credit.credit.status) || credit.credit.issueDate.getTime() > asOfMs) continue
      if (!ISSUED_CREDIT.has(credit.credit.status) || credit.exVat === null) return { ...base, disposition: 'held', reason: 'unknown-credit' }
      credit.counted = true
    }
    return { ...base, disposition: 'counted', reason: 'issued' }
  }
  const visibleIssued = !invoice.viewHidden && invoice.issueDate.getTime() <= asOfMs && ISSUED_INVOICE.has(invoice.status) && invoice.clientId === clientId
  if (visibleIssued) return { ...base, disposition: 'unlinked', reason: 'no-project-link' }
  return { ...base, disposition: 'excluded', reason: 'not-linked' }
}

function costsPartial(snapshot: BillingSnapshot) {
  if (snapshot.coverage.events === 0) return true
  if (snapshot.lines.length === 0) return true
  if (snapshot.coverage.held > 0 || snapshot.coverage.fxMissing > 0) return true
  return snapshot.lines.some(line => line.held || line.amountMinor === null)
}

function knownCostPence(snapshot: BillingSnapshot, asOfDay: string) {
  let total: bigint | null = null
  const byDay = new Map<string, bigint>()
  for (const line of snapshot.lines) {
    if (line.held || line.amountMinor === null || line.periodStart > asOfDay) continue
    if (!Number.isSafeInteger(line.amountMinor)) throw new Error('Billing amount exceeds safe integer range')
    const pence = BigInt(line.amountMinor)
    total = (total ?? BigInt(0)) + pence
    byDay.set(line.periodStart, (byDay.get(line.periodStart) ?? BigInt(0)) + pence)
  }
  return { total, byDay }
}

export function buildProjectBilling(input: {
  projectSlug: string
  projectId: string
  clientId: string | null
  asOf: Date
  snapshot: BillingSnapshot
  invoices: BillingInvoice[]
  associations: BillingLink[]
  mappings: BillingLink[]
}) {
  const asOfMs = input.asOf.getTime()
  if (!Number.isFinite(asOfMs)) throw new Error('asOf must be a valid timestamp')
  const targetsByInvoice = new Map<string, Set<string>>()
  const knownIds = new Set(input.invoices.map(invoice => invoice.id))
  for (const link of [...input.associations, ...input.mappings]) {
    if (!knownIds.has(link.invoiceId)) continue
    const targets = targetsByInvoice.get(link.invoiceId) ?? new Set<string>()
    targets.add(link.projectId)
    targetsByInvoice.set(link.invoiceId, targets)
  }
  const seen = new Set<string>()
  const classified: Classified[] = []
  for (const invoice of input.invoices) {
    if (seen.has(invoice.id)) continue
    seen.add(invoice.id)
    const targets = targetsByInvoice.get(invoice.id) ?? new Set<string>()
    if (targets.size > 0 && !targets.has(input.projectId)) continue
    if (targets.size === 0 && (!input.clientId || invoice.clientId !== input.clientId)) continue
    const row = classifyInvoice(invoice, input.projectId, input.clientId, targets, asOfMs)
    if (targets.size === 0 && row.disposition === 'excluded') continue
    classified.push(row)
  }

  const counted: CountedInvoice[] = []
  let conflictingInvoiceCount = 0
  let unlinkedInvoiceCount = 0
  for (const row of classified) {
    if (row.disposition === 'held') conflictingInvoiceCount += 1
    else if (row.disposition === 'unlinked') unlinkedInvoiceCount += 1
    else if (row.disposition === 'counted' && row.exVat !== null) {
      counted.push({ invoice: row.invoice, exVat: row.exVat, credits: row.credits.filter(credit => credit.counted && credit.exVat !== null).map(credit => ({ credit: credit.credit, exVat: credit.exVat! })) })
    }
  }

  let issued = BigInt(0)
  let credits = BigInt(0)
  let creditCount = 0
  let invoicesBeforeCostLedger = 0
  const netByDay = new Map<string, bigint>()
  const addNet = (day: string, pence: bigint) => netByDay.set(day, (netByDay.get(day) ?? BigInt(0)) + pence)
  const creditIds = new Set<string>()
  for (const row of counted) {
    issued += row.exVat
    if (row.invoice.issueDate.getTime() < Date.parse(LEDGER_START)) invoicesBeforeCostLedger += 1
    addNet(dayOf(row.invoice.issueDate), row.exVat)
    for (const credit of row.credits) {
      if (creditIds.has(credit.credit.id)) continue
      creditIds.add(credit.credit.id)
      credits += credit.exVat
      creditCount += 1
      addNet(dayOf(credit.credit.issueDate), -credit.exVat)
    }
  }

  const asOfDay = dayOf(input.asOf)
  const { total: costTotal, byDay: costByDay } = knownCostPence(input.snapshot, asOfDay < LEDGER_DAY ? '0000-01-01' : asOfDay)
  const balanceTrusted = conflictingInvoiceCount === 0
  const issuedPence = safe(issued)
  const creditPence = safe(credits)
  const netInvoiced = issued - credits
  const netInvoicedPence = safe(netInvoiced)
  const costTotalPence = costTotal === null ? null : safe(costTotal)
  const remainingToInvoicePence = !balanceTrusted || costTotal === null ? null : safe(costTotal - netInvoiced)

  let start = LEDGER_DAY
  for (const day of netByDay.keys()) if (day < start) start = day
  if (start > asOfDay) start = asOfDay
  if ((Date.parse(`${asOfDay}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86400000 > HISTORY_SPAN_DAYS) start = addDays(asOfDay, -HISTORY_SPAN_DAYS)
  const days = enumerateDays(start, asOfDay)

  const costDates = [...costByDay.keys()].sort()
  const netDates = [...netByDay.keys()].sort()
  let costCursor = BigInt(0)
  let netCursor = BigInt(0)
  let costIndex = 0
  let netIndex = 0
  let costStarted = false
  const history = days.map(day => {
    while (netIndex < netDates.length && netDates[netIndex] <= day) {
      netCursor += netByDay.get(netDates[netIndex]) ?? BigInt(0)
      netIndex += 1
    }
    let costPence: number | null = null
    if (costTotal !== null && day >= LEDGER_DAY) {
      while (costIndex < costDates.length && costDates[costIndex] <= day) {
        costCursor += costByDay.get(costDates[costIndex]) ?? BigInt(0)
        costIndex += 1
      }
      costStarted = true
      costPence = safe(costCursor)
    }
    return {
      day,
      costPence,
      invoicedPence: safe(netCursor),
      remainingToInvoicePence: !balanceTrusted || !costStarted || costPence === null ? null : safe(BigInt(costPence) - netCursor),
    }
  })

  const envelopeWithoutRevision: Omit<ProjectBillingEnvelope, 'revision'> = {
    version: 'mpdee-project-billing-v1' as const,
    project: input.projectSlug,
    currency: 'GBP' as const,
    allocationMode: 'whole-invoice-ex-vat' as const,
    balanceBasis: 'costs-minus-invoices' as const,
    asOf: input.asOf.toISOString(),
    costSnapshot: input.snapshot,
    costTotalPence,
    invoiceTotals: { issuedPence, creditPence, netInvoicedPence, invoiceCount: counted.length, creditCount },
    remainingToInvoicePence,
    coverage: {
      unlinkedInvoiceCount,
      conflictingInvoiceCount,
      costsPartial: costsPartial(input.snapshot),
      costLedgerStart: LEDGER_START,
      invoicesBeforeCostLedger,
    },
    history,
  }
  const revision = createHash('sha256').update(JSON.stringify(envelopeWithoutRevision)).digest('hex')
  const envelope: ProjectBillingEnvelope = {
    version: envelopeWithoutRevision.version,
    project: envelopeWithoutRevision.project,
    currency: envelopeWithoutRevision.currency,
    allocationMode: envelopeWithoutRevision.allocationMode,
    balanceBasis: envelopeWithoutRevision.balanceBasis,
    asOf: envelopeWithoutRevision.asOf,
    revision,
    costSnapshot: envelopeWithoutRevision.costSnapshot,
    costTotalPence: envelopeWithoutRevision.costTotalPence,
    invoiceTotals: envelopeWithoutRevision.invoiceTotals,
    remainingToInvoicePence: envelopeWithoutRevision.remainingToInvoicePence,
    coverage: envelopeWithoutRevision.coverage,
    history: envelopeWithoutRevision.history,
  }
  const report: BillingReportDocument[] = classified.map(row => ({
    invoiceId: row.invoice.id,
    invoiceNumber: row.invoice.invoiceNumber ?? null,
    clientId: row.invoice.clientId,
    status: row.invoice.status,
    issueDate: row.invoice.issueDate.toISOString(),
    disposition: row.disposition,
    reason: row.reason,
    exVatPence: row.disposition === 'counted' && row.exVat !== null ? safe(row.exVat) : null,
    credits: row.credits.map(credit => ({
      creditNoteId: credit.credit.id,
      creditNoteNumber: credit.credit.creditNoteNumber ?? null,
      issueDate: credit.credit.issueDate.toISOString(),
      exVatPence: credit.exVat === null ? null : safe(credit.exVat),
      counted: credit.counted,
    })),
  }))
  return { envelope, report }
}
