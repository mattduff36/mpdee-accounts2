import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseCurrency } from "@/lib/format"
import { createInvoiceWithAllocatedNumber } from "@/lib/invoice-number"

const BUSINESS_AREAS = [
  { value: "CREATIVE", label: "Creative" },
  { value: "DEVELOPMENT", label: "Development" },
  { value: "SUPPORT", label: "Support" },
]

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
          businessArea: areas[i] || "CREATIVE",
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

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader title="New Invoice" />
      <form action={createInvoice} className="space-y-6 rounded-lg border bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client *</label>
            <select name="clientId" required className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms (days)</label>
            <Input name="paymentTerms" type="number" defaultValue={String(settings?.defaultPaymentTerms || 30)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Issue Date *</label>
            <Input name="issueDate" type="date" required defaultValue={new Date().toISOString().split("T")[0]} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Due Date *</label>
            <Input name="dueDate" type="date" required />
          </div>
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">Line Items</h3>
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-12 items-end rounded-md border p-3">
                <div className="sm:col-span-4">
                  <label className="block text-xs text-gray-500 mb-1">Description</label>
                  <Input name="description[]" placeholder="Item description" />
                </div>
                <div className="sm:col-span-1">
                  <label className="block text-xs text-gray-500 mb-1">Qty</label>
                  <Input name="quantity[]" type="number" step="0.01" defaultValue="1" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Rate</label>
                  <Input name="unitPrice[]" type="text" placeholder="0.00" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Agency %</label>
                  <Input name="agencyCommission[]" type="number" step="0.1" defaultValue="0" />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs text-gray-500 mb-1">Business Area</label>
                  <select name="businessArea[]" className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" defaultValue="CREATIVE">
                    {BUSINESS_AREAS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (client-visible)</label>
            <textarea name="notes" rows={3} className="flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Internal Notes</label>
            <textarea name="internalNotes" rows={3} className="flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit">Save as Draft</Button>
          <a href="/invoices">
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </a>
        </div>
      </form>
    </div>
  )
}
