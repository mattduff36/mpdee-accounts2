import type { Prisma } from "@prisma/client"

export const visibleInvoiceWhere = { viewHidden: false } satisfies Prisma.InvoiceWhereInput

export const visiblePaymentWhere = {
  OR: [{ invoiceId: null }, { invoice: { is: { viewHidden: false } } }],
} satisfies Prisma.PaymentWhereInput

export const visibleAuditWhere = {
  OR: [{ invoiceId: null }, { invoice: { is: { viewHidden: false } } }],
} satisfies Prisma.AuditLogWhereInput

export function andVisibleInvoice(where: Prisma.InvoiceWhereInput): Prisma.InvoiceWhereInput {
  return { AND: [where, visibleInvoiceWhere] }
}

export function visibleInvoiceOrNull<T extends { viewHidden: boolean }>(invoice: T | null): T | null {
  if (!invoice || invoice.viewHidden) return null
  return invoice
}
