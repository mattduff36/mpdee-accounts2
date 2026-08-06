import { Prisma } from "@prisma/client"
import { prisma } from "./db"

type Tx = Prisma.TransactionClient

async function nextNumberInTx(tx: Tx, prefix: string): Promise<string> {
  const year = new Date().getFullYear()
  const pattern = `${prefix}-${year}-`
  const lockKey = `invoice-number:${pattern}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`

  const invoices = await tx.invoice.findMany({
    where: { invoiceNumber: { startsWith: pattern } },
    select: { invoiceNumber: true },
    orderBy: { invoiceNumber: "desc" },
    take: 50,
  })

  let nextNumber = 1
  for (const inv of invoices) {
    const match = inv.invoiceNumber.match(/-(\d+)$/)
    if (match) {
      const n = parseInt(match[1], 10)
      if (n >= nextNumber) nextNumber = n + 1
    }
  }

  return `${prefix}-${year}-${nextNumber.toString().padStart(3, "0")}`
}

/** Peek next number inside a short transaction (verification only). */
export async function allocateInvoiceNumber(prefix = process.env.INVOICE_PREFIX || "MPD"): Promise<string> {
  return prisma.$transaction((tx) => nextNumberInTx(tx, prefix))
}

/**
 * Allocate number and create invoice in the same transaction so the advisory
 * lock covers the insert (prevents duplicate MPD-YYYY-NNN under concurrency).
 */
export async function createInvoiceWithAllocatedNumber(
  prefix: string,
  data: Omit<Prisma.InvoiceCreateInput, "invoiceNumber">
) {
  return prisma.$transaction(async (tx) => {
    const invoiceNumber = await nextNumberInTx(tx, prefix)
    return tx.invoice.create({
      data: { ...data, invoiceNumber },
    })
  })
}
