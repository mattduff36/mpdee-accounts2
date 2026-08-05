import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RECURRING_FREQUENCIES } from "@/lib/constants"
import { parseCurrency } from "@/lib/format"

export default async function NewRecurringPage() {
  const clients = await prisma.client.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } })
  async function createTemplate(formData: FormData) {
    "use server"
    const descriptions = formData.getAll("description[]") as string[]
    const quantities = formData.getAll("quantity[]") as string[]
    const unitPrices = formData.getAll("unitPrice[]") as string[]
    let subtotal = 0
    const items = descriptions.map((desc, i) => {
      const qty = parseFloat(quantities[i] || "1")
      const price = parseCurrency(unitPrices[i] || "0")
      const lineTotal = Math.round(qty * price)
      subtotal += lineTotal
      return { description: desc, quantity: qty, unitPrice: price, lineTotal, sortOrder: i }
    })
    await prisma.recurringInvoice.create({ data: {
      templateName: String(formData.get("templateName")),
      clientId: String(formData.get("clientId")),
      frequency: String(formData.get("frequency")),
      startDate: new Date(String(formData.get("startDate"))),
      endDate: formData.get("endDate") ? new Date(String(formData.get("endDate"))) : undefined,
      dayOfMonth: Number(formData.get("dayOfMonth") || 1),
      subtotal, total: subtotal,
      items: { create: items }
    }})
    redirect("/recurring")
  }
  return <div className="space-y-6 max-w-4xl">
    <PageHeader title="New Recurring Template" />
    <form action={createTemplate} className="space-y-6 rounded-lg border bg-white p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Template Name *</label><Input name="templateName" required /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Client *</label><select name="clientId" required className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Frequency *</label><select name="frequency" required className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">{RECURRING_FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label><Input name="startDate" type="date" required /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">End Date</label><Input name="endDate" type="date" /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Day of Month</label><Input name="dayOfMonth" type="number" min={1} max={28} defaultValue="1" /></div>
      </div>
      <div><h3 className="text-sm font-medium text-gray-700 mb-2">Line Items</h3>
        {[0, 1].map(i => <div key={i} className="grid gap-2 sm:grid-cols-12 items-end rounded-md border p-3 mb-2">
          <div className="sm:col-span-6"><label className="block text-xs text-gray-500 mb-1">Description</label><Input name="description[]" placeholder="Item description" /></div>
          <div className="sm:col-span-2"><label className="block text-xs text-gray-500 mb-1">Qty</label><Input name="quantity[]" type="number" step="0.01" defaultValue="1" /></div>
          <div className="sm:col-span-3"><label className="block text-xs text-gray-500 mb-1">Unit Price</label><Input name="unitPrice[]" type="text" placeholder="0.00" /></div>
        </div>)}
      </div>
      <div className="flex gap-2"><Button type="submit">Save Template</Button><a href="/recurring"><Button type="button" variant="secondary">Cancel</Button></a></div>
    </form>
  </div>
}
