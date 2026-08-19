import { prisma } from "./db"
import { parseIsoDateOnly } from "./invoice-date"
import { buildValidatedInvoiceItems, type BuiltInvoiceItem } from "./invoice-items"
import { invoiceSendLockKey } from "./invoice-send-lock"

export type InvoiceEditErrorCode = "not_found" | "conflict"

export type InvoiceEditRedirectKey =
  | "pending-send"
  | "not-draft"
  | "empty-items"
  | "invalid"
  | "has-payments"
  | "save-failed"

export class InvoiceEditError extends Error {
  readonly code: InvoiceEditErrorCode
  readonly redirectKey: InvoiceEditRedirectKey

  constructor(code: InvoiceEditErrorCode, redirectKey: InvoiceEditRedirectKey, message: string) {
    super(message)
    this.name = "InvoiceEditError"
    this.code = code
    this.redirectKey = redirectKey
  }
}

export const INVOICE_EDIT_ERROR_MESSAGES: Record<InvoiceEditRedirectKey, string> = {
  "pending-send": "This invoice is being sent and cannot be edited right now.",
  "not-draft": "Only draft invoices can be edited.",
  "empty-items": "Add at least one line item with a description.",
  invalid: "Some invoice details are invalid. Check quantities, rates, dates, and the client.",
  "has-payments": "This draft has payment records and cannot be edited.",
  "save-failed": "The invoice could not be saved. Try again.",
}

export function invoiceEditErrorMessage(key: string | undefined): string | null {
  if (!key || !(key in INVOICE_EDIT_ERROR_MESSAGES)) return null
  return INVOICE_EDIT_ERROR_MESSAGES[key as InvoiceEditRedirectKey]
}

export type DraftInvoiceUpdateInput = {
  clientId: string
  paymentTerms: string
  issueDate: string
  dueDate: string
  notes: string
  internalNotes: string
  descriptions: string[]
  quantities: string[]
  unitPrices: string[]
  commissions: string[]
  areas: string[]
}

export function draftInvoiceInputFromForm(formData: FormData): DraftInvoiceUpdateInput {
  return {
    clientId: String(formData.get("clientId") || ""),
    paymentTerms: String(formData.get("paymentTerms") || ""),
    issueDate: String(formData.get("issueDate") || ""),
    dueDate: String(formData.get("dueDate") || ""),
    notes: String(formData.get("notes") || ""),
    internalNotes: String(formData.get("internalNotes") || ""),
    descriptions: formData.getAll("description[]").map(String),
    quantities: formData.getAll("quantity[]").map(String),
    unitPrices: formData.getAll("unitPrice[]").map(String),
    commissions: formData.getAll("agencyCommission[]").map(String),
    areas: formData.getAll("businessArea[]").map(String),
  }
}

type DraftInvoiceRecord = {
  id: string
  invoiceNumber: string
  status: string
  amountPaid: number
  sentAt: Date | null
  viewedAt: Date | null
  paidAt: Date | null
  cancelledAt: Date | null
  writtenOffAt: Date | null
}

export type DraftEditTx = {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
  invoice: {
    findUnique: (args: { where: { id: string } }) => Promise<DraftInvoiceRecord | null>
    updateMany: (args: {
      where: { id: string; status: string }
      data: Record<string, unknown>
    }) => Promise<{ count: number }>
  }
  invoiceItem: {
    deleteMany: (args: { where: { invoiceId: string } }) => Promise<unknown>
    createMany: (args: { data: Array<Record<string, unknown>> }) => Promise<unknown>
  }
  client: {
    findUnique: (args: { where: { id: string }; select: { id: true } }) => Promise<{ id: string } | null>
  }
  emailLog: {
    findFirst: (args: { where: { invoiceId: string; status: string } }) => Promise<{ id: string } | null>
  }
  payment: {
    count: (args: { where: { invoiceId: string } }) => Promise<number>
  }
  creditNote: {
    count: (args: { where: { invoiceId: string } }) => Promise<number>
  }
}

export type DraftEditDb = {
  $transaction: <T>(fn: (tx: DraftEditTx) => Promise<T>) => Promise<T>
}

export type UpdateDraftInvoiceDeps = {
  db?: DraftEditDb
  logError?: (message: string, extra?: Record<string, unknown>) => void
}

function parsePaymentTerms(value: string): number {
  const terms = Number(value)
  if (!Number.isInteger(terms) || terms < 0 || terms > 365) {
    throw new InvoiceEditError("conflict", "invalid", INVOICE_EDIT_ERROR_MESSAGES.invalid)
  }
  return terms
}

function parseItems(input: DraftInvoiceUpdateInput): BuiltInvoiceItem[] {
  try {
    return buildValidatedInvoiceItems(input)
  } catch {
    throw new InvoiceEditError("conflict", "invalid", INVOICE_EDIT_ERROR_MESSAGES.invalid)
  }
}

export async function updateDraftInvoice(
  invoiceId: string,
  input: DraftInvoiceUpdateInput,
  deps: UpdateDraftInvoiceDeps = {},
) {
  const db = deps.db ?? (prisma as unknown as DraftEditDb)
  const logError = deps.logError ?? ((message, extra) => console.error(message, extra))

  let items: BuiltInvoiceItem[]
  let issueDate: Date
  let dueDate: Date
  let paymentTerms: number
  try {
    items = parseItems(input)
    issueDate = parseIsoDateOnly(input.issueDate)
    dueDate = parseIsoDateOnly(input.dueDate)
    paymentTerms = parsePaymentTerms(input.paymentTerms)
  } catch (error) {
    if (error instanceof InvoiceEditError) throw error
    throw new InvoiceEditError("conflict", "invalid", INVOICE_EDIT_ERROR_MESSAGES.invalid)
  }

  if (items.length === 0) {
    throw new InvoiceEditError("conflict", "empty-items", INVOICE_EDIT_ERROR_MESSAGES["empty-items"])
  }
  if (!input.clientId.trim()) {
    throw new InvoiceEditError("conflict", "invalid", INVOICE_EDIT_ERROR_MESSAGES.invalid)
  }

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0)
  const total = subtotal

  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceSendLockKey(invoiceId)}))`

      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } })
      if (!invoice) {
        throw new InvoiceEditError("not_found", "save-failed", "Invoice not found")
      }
      if (invoice.status !== "draft") {
        throw new InvoiceEditError("conflict", "not-draft", INVOICE_EDIT_ERROR_MESSAGES["not-draft"])
      }

      const pendingSend = await tx.emailLog.findFirst({
        where: { invoiceId, status: "pending" },
      })
      if (pendingSend) {
        throw new InvoiceEditError("conflict", "pending-send", INVOICE_EDIT_ERROR_MESSAGES["pending-send"])
      }

      if (invoice.amountPaid !== 0) {
        throw new InvoiceEditError("conflict", "has-payments", INVOICE_EDIT_ERROR_MESSAGES["has-payments"])
      }

      const [paymentCount, creditCount] = await Promise.all([
        tx.payment.count({ where: { invoiceId } }),
        tx.creditNote.count({ where: { invoiceId } }),
      ])
      if (paymentCount > 0 || creditCount > 0) {
        throw new InvoiceEditError("conflict", "has-payments", INVOICE_EDIT_ERROR_MESSAGES["has-payments"])
      }

      const client = await tx.client.findUnique({
        where: { id: input.clientId },
        select: { id: true },
      })
      if (!client) {
        throw new InvoiceEditError("conflict", "invalid", INVOICE_EDIT_ERROR_MESSAGES.invalid)
      }

      await tx.invoiceItem.deleteMany({ where: { invoiceId } })
      await tx.invoiceItem.createMany({
        data: items.map((item) => ({
          invoiceId,
          ...item,
        })),
      })
      const updated = await tx.invoice.updateMany({
        where: { id: invoiceId, status: "draft" },
        data: {
          clientId: input.clientId,
          paymentTerms,
          issueDate,
          dueDate,
          notes: input.notes,
          internalNotes: input.internalNotes,
          subtotal,
          vatTotal: 0,
          discountTotal: 0,
          total,
          balanceDue: total - invoice.amountPaid,
        },
      })
      if (updated.count !== 1) {
        throw new InvoiceEditError("conflict", "not-draft", INVOICE_EDIT_ERROR_MESSAGES["not-draft"])
      }

      return { invoiceId, total, itemCount: items.length }
    })
  } catch (error) {
    if (error instanceof InvoiceEditError) throw error
    logError("Draft invoice update failed", { invoiceId, errorType: error instanceof Error ? error.name : "unknown" })
    throw new InvoiceEditError("conflict", "save-failed", INVOICE_EDIT_ERROR_MESSAGES["save-failed"])
  }
}
