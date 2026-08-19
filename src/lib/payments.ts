import { DEFAULT_PAYMENT_METHOD, MARK_PAID_ELIGIBLE_STATUSES } from "./constants"
import { prisma } from "./db"
import { sendPaymentReceivedEmail } from "./email"

export type MarkPaidErrorCode = "not_found" | "conflict"

export class MarkPaidError extends Error {
  readonly code: MarkPaidErrorCode
  readonly httpStatus: 404 | 409

  constructor(code: MarkPaidErrorCode, message: string) {
    super(message)
    this.name = "MarkPaidError"
    this.code = code
    this.httpStatus = code === "not_found" ? 404 : 409
  }
}

export type InvoiceBalances = {
  total: number
  amountPaid: number
  balanceDue: number
}

export type MarkPaidInvoice = InvoiceBalances & {
  id: string
  clientId: string
  status: string
  paidAt?: Date | null
}

export type MarkPaidTx = {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
  invoice: {
    findUnique: (args: { where: { id: string } }) => Promise<MarkPaidInvoice | null>
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>
  }
  payment: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>
  }
}

export type MarkPaidDb = {
  $transaction: <T>(fn: (tx: MarkPaidTx) => Promise<T>) => Promise<T>
}

export type MarkInvoicePaidDeps = {
  db?: MarkPaidDb
  sendPaymentReceivedEmail?: (
    invoiceId: string,
    options?: { amountPaidPence?: number }
  ) => Promise<{ ok: boolean; error?: string }>
  now?: Date
  logError?: (message: string, extra?: Record<string, unknown>) => void
}

export function isEligibleMarkPaidStatus(status: string): boolean {
  return (MARK_PAID_ELIGIBLE_STATUSES as readonly string[]).includes(status)
}

export function invoiceSendMode(status: string): "send" | "resend" | null {
  if (status === "draft") return "send"
  if (isEligibleMarkPaidStatus(status)) return "resend"
  return null
}

export function remainingBalanceToPay(invoice: InvoiceBalances): number {
  const derived = invoice.total - invoice.amountPaid
  if (derived <= 0) {
    throw new MarkPaidError("conflict", "Invoice has no remaining balance")
  }
  if (invoice.balanceDue === derived) return derived
  if (invoice.balanceDue === 0) return derived
  throw new MarkPaidError("conflict", "Invoice balance is inconsistent")
}

export async function markInvoicePaid(invoiceId: string, deps: MarkInvoicePaidDeps = {}) {
  const db = deps.db ?? (prisma as unknown as MarkPaidDb)
  const now = deps.now ?? new Date()
  const sendEmail = deps.sendPaymentReceivedEmail ?? sendPaymentReceivedEmail
  const logError = deps.logError ?? ((message, extra) => console.error(message, extra))

  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-mark-paid:${invoiceId}`}))`

    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } })
    if (!invoice) throw new MarkPaidError("not_found", "Invoice not found")
    if (!isEligibleMarkPaidStatus(invoice.status)) {
      throw new MarkPaidError(
        "conflict",
        invoice.status === "paid" ? "Invoice is already paid" : "Invoice cannot be marked as paid"
      )
    }

    const amount = remainingBalanceToPay(invoice)
    const payment = await tx.payment.create({
      data: {
        invoiceId,
        clientId: invoice.clientId,
        amount,
        date: now,
        method: DEFAULT_PAYMENT_METHOD,
        notes: "Marked as paid",
      },
    })

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: invoice.total,
        balanceDue: 0,
        status: "paid",
        paidAt: now,
      },
    })

    return { paymentId: payment.id, amount, invoiceId }
  })

  try {
    const email = await sendEmail(invoiceId, { amountPaidPence: result.amount })
    if (!email.ok) {
      logError("Payment received email failed after mark-paid", {
        invoiceId,
        paymentId: result.paymentId,
        error: email.error,
      })
    }
  } catch (error) {
    logError("Payment received email threw after mark-paid", {
      invoiceId,
      paymentId: result.paymentId,
      error,
    })
  }

  return result
}
