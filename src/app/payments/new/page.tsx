import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PAYMENT_METHODS } from "@/lib/constants"
import { parseCurrency, formatCurrency } from "@/lib/format"

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ invoiceId?: string }> }) {
  const sp = await searchParams
  const invoices = await prisma.invoice.findMany({ where: { status: { in: ["sent", "viewed", "partial", "overdue"] } }, include: { client: { select: { name: true } } }, orderBy: { createdAt: "desc" } })
  async function recordPayment(formData: FormData) {
    "use server"
    const invoiceId = String(formData.get("invoiceId"))
    const amount = parseCurrency(String(formData.get("amount")))
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })
    if (!invoice) throw new Error("Invoice not found")
    await prisma.payment.create({ data: { invoiceId, clientId: invoice.clientId, amount, date: new Date(String(formData.get("date"))), method: String(formData.get("method")), reference: String(formData.get("reference") || ""), notes: String(formData.get("notes") || "") } })
    const newPaid = invoice.amountPaid + amount
    const newStatus = newPaid >= invoice.total ? "paid" : "partial"
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: newPaid,
        balanceDue: Math.max(0, invoice.total - newPaid),
        status: newStatus,
        paidAt: newPaid >= invoice.total ? new Date() : invoice.paidAt,
      },
    })
    if (newStatus === "paid") {
      try {
        const { sendPaymentReceivedEmail } = await import("@/lib/email")
        await sendPaymentReceivedEmail(invoiceId)
      } catch {
        // Payment already saved; email failure must not roll back
      }
    }
    redirect("/payments")
  }
  return <div className="space-y-6 max-w-xl">
    <PageHeader title="Record Payment" />
    <form action={recordPayment} className="space-y-4 rounded-lg border bg-white p-6">
      <div><label className="block text-sm font-medium text-gray-700 mb-1">Invoice *</label><select name="invoiceId" required defaultValue={sp.invoiceId || ""} className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"><option value="">Select invoice</option>{invoices.map(i => <option key={i.id} value={i.id}>{i.invoiceNumber} - {i.client.name} ({formatCurrency(i.balanceDue)} due)</option>)}</select></div>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">Amount *</label><Input name="amount" type="text" placeholder="0.00" required /></div>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">Date *</label><Input name="date" type="date" required defaultValue={new Date().toISOString().split("T")[0]} /></div>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">Method *</label><select name="method" required className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">{PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}</select></div>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">Reference</label><Input name="reference" /></div>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes</label><textarea name="notes" rows={2} className="flex min-h-[60px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" /></div>
      <div className="flex gap-2"><Button type="submit">Record Payment</Button><a href="/payments"><Button type="button" variant="secondary">Cancel</Button></a></div>
    </form>
  </div>
}
