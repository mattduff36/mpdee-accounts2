import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EXPENSE_PAYMENT_METHODS } from "@/lib/constants"
import { parseCurrency } from "@/lib/format"

export default async function NewExpensePage() {
  const categories = await prisma.expenseCategory.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } })
  const clients = await prisma.client.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } })
  async function createExpense(formData: FormData) {
    "use server"
    const netAmount = parseCurrency(String(formData.get("netAmount")))
    const vatRate = Number(formData.get("vatRate") || 20)
    const vatAmount = vatRate > 0 ? Math.round(netAmount * (vatRate / 100)) : 0
    await prisma.expense.create({ data: {
      categoryId: String(formData.get("categoryId")),
      clientId: String(formData.get("clientId") || ""),
      date: new Date(String(formData.get("date"))),
      supplier: String(formData.get("supplier") || ""),
      description: String(formData.get("description")),
      netAmount, vatAmount, grossAmount: netAmount + vatAmount, vatRate,
      paymentMethod: String(formData.get("paymentMethod")),
      reference: String(formData.get("reference") || ""),
      isReimbursable: formData.get("isReimbursable") === "on",
      isBillable: formData.get("isBillable") === "on",
      notes: String(formData.get("notes") || ""),
    }})
    redirect("/expenses")
  }
  return <div className="space-y-6 max-w-2xl">
    <PageHeader title="New Expense" />
    <form action={createExpense} className="space-y-4 rounded-lg border bg-white p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Category *</label><select name="categoryId" required className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Date *</label><Input name="date" type="date" required defaultValue={new Date().toISOString().split("T")[0]} /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label><Input name="supplier" /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Description *</label><Input name="description" required /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Net Amount *</label><Input name="netAmount" type="text" placeholder="0.00" required /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">VAT Rate</label><select name="vatRate" className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"><option value="20">20%</option><option value="5">5%</option><option value="0">0%</option></select></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label><select name="paymentMethod" className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">{EXPENSE_PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}</select></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Reference</label><Input name="reference" /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Client (if billable)</label><select name="clientId" className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"><option value="">None</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isReimbursable" className="rounded border-gray-300" />Reimbursable</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isBillable" className="rounded border-gray-300" />Billable</label>
      </div>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes</label><textarea name="notes" rows={2} className="flex min-h-[60px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" /></div>
      <div className="flex gap-2"><Button type="submit">Save Expense</Button><a href="/expenses"><Button type="button" variant="secondary">Cancel</Button></a></div>
    </form>
  </div>
}
