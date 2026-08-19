import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import { NewInvoiceForm } from "@/components/NewInvoiceForm"
import { parseCurrency } from "@/lib/format"
import { createInvoiceWithAllocatedNumber } from "@/lib/invoice-number"

export default async function NewInvoicePage() {
  const clients = await prisma.client.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } })
  const settings = await prisma.companySettings.findUnique({ where: { id: "default" } })

  async function createInvoice(formData: FormData) {
    "use server"
    const clientId = String(formData.get("clientId"))
    const prefix = settings?.invoicePrefix || process.env.INVOICE_PREFIX || "MPD"
    const terms = Number(formData.get("paymentTerms") || 30)
    const issueDate = new Date(String(formData.get("issueDate")))
    const dueDate = new Date(String(formData.get("dueDate")))
    const descriptions = formData.getAll("description[]") as string[]
    const quantities = formData.getAll("quantity[]") as string[]
    const unitPrices = formData.getAll("unitPrice[]") as string[]
    const commissions = formData.getAll("agencyCommission[]") as string[]
    const areas = formData.getAll("businessArea[]") as string[]

    let subtotal = 0
    const items = descriptions
      .map((desc, i) => {
        if (!desc?.trim()) return null
        const qty = parseFloat(quantities[i] || "1")
        const price = parseCurrency(unitPrices[i] || "0")
        const commission = parseFloat(commissions[i] || "0") || 0
        const gross = Math.round(qty * price)
        const commissionAmount = commission > 0 ? Math.round(gross * (commission / 100)) : 0
        const lineTotal = Math.max(0, gross - commissionAmount)
        subtotal += lineTotal
        return {
          description: desc.trim(),
          quantity: qty,
          unitPrice: price,
          vatRate: 0,
          discount: 0,
          lineTotal,
          vatAmount: 0,
          agencyCommission: commission,
          businessArea: areas[i] || "DEVELOPMENT",
          sortOrder: i,
        }
      })
      .filter(Boolean) as Array<{
      description: string
      quantity: number
      unitPrice: number
      vatRate: number
      discount: number
      lineTotal: number
      vatAmount: number
      agencyCommission: number
      businessArea: string
      sortOrder: number
    }>

    if (items.length === 0) redirect("/invoices/new")

    const total = subtotal
    await createInvoiceWithAllocatedNumber(prefix, {
      client: { connect: { id: clientId } },
      status: "draft",
      issueDate,
      dueDate,
      paymentTerms: terms,
      subtotal,
      vatTotal: 0,
      discountTotal: 0,
      total,
      balanceDue: total,
      notes: String(formData.get("notes") || ""),
      internalNotes: String(formData.get("internalNotes") || ""),
      vatEnabled: false,
      items: { create: items },
    })
    redirect("/invoices")
  }

  const today = new Date()
  const defaultIssueDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`

  return (
    <NewInvoiceForm
      clients={clients.map((client) => ({ id: client.id, name: client.name }))}
      defaultPaymentTerms={settings?.defaultPaymentTerms || 30}
      defaultIssueDate={defaultIssueDate}
      action={createInvoice}
    />
  )
}
