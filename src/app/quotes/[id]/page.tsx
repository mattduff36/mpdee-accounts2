import { prisma } from "@/lib/db"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { StatusBadge } from "@/components/StatusBadge"
import { IconAction } from "@/components/IconAction"
import { FileInput, Send } from "lucide-react"
import { notFound, redirect } from "next/navigation"

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const quote = await prisma.quote.findUnique({ where: { id }, include: { client: true, items: true } })
  if (!quote) notFound()
  const q = quote!
  async function convertToInvoice() {
    "use server"
    const { createInvoiceWithAllocatedNumber } = await import("@/lib/invoice-number")
    const settings = await prisma.companySettings.findUnique({ where: { id: "default" } })
    const prefix = settings?.invoicePrefix || process.env.INVOICE_PREFIX || "MPD"
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 30)
    const invoice = await createInvoiceWithAllocatedNumber(prefix, {
      client: { connect: { id: q.clientId } },
      status: "draft",
      issueDate: new Date(),
      dueDate,
      subtotal: q.subtotal,
      vatTotal: q.vatTotal,
      total: q.total,
      balanceDue: q.total,
      vatEnabled: false,
      items: {
        create: q.items.map((item, i) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          sortOrder: i,
        })),
      },
    })
    await prisma.quote.update({ where: { id }, data: { status: "converted", convertedToInvoiceId: invoice.id } })
    redirect(`/invoices/${invoice.id}`)
  }
  return <div className="space-y-6 max-w-4xl">
    <PageHeader title={`Quote ${quote.quoteNumber}`}>
      {quote.status === "draft" && <form action={async () => { "use server"; await prisma.quote.update({ where: { id }, data: { status: "sent" } }) }}><IconAction title="Mark as Sent" icon={Send} tone="green" type="submit" /></form>}
      {quote.status !== "converted" && <form action={convertToInvoice}><IconAction title="Convert to Invoice" icon={FileInput} tone="blue" type="submit" /></form>}
    </PageHeader>
    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-lg border bg-white p-4"><p className="text-sm text-gray-500">Total</p><p className="text-2xl font-bold">{formatCurrency(q.total)}</p></div>
      <div className="rounded-lg border bg-white p-4"><p className="text-sm text-gray-500">Status</p><p className="text-xl font-bold"><StatusBadge status={quote.status} /></p></div>
      <div className="rounded-lg border bg-white p-4"><p className="text-sm text-gray-500">Expires</p><p className="text-xl font-bold">{formatDate(quote.expiryDate)}</p></div>
    </div>
    <div className="rounded-lg border bg-white p-6"><p className="font-medium">{q.client.name}</p>{q.client.companyName && <p className="text-gray-500">{q.client.companyName}</p>}</div>
    <div className="rounded-lg border bg-white"><table className="w-full text-sm"><thead><tr className="border-b bg-gray-50"><th className="px-4 py-2 text-left">Description</th><th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2 text-right">Price</th><th className="px-4 py-2 text-right">Total</th></tr></thead>
      <tbody>{q.items.map(item => <tr key={item.id} className="border-t"><td className="px-4 py-2">{item.description}</td><td className="px-4 py-2 text-right">{item.quantity}</td><td className="px-4 py-2 text-right">{formatCurrency(item.unitPrice)}</td><td className="px-4 py-2 text-right font-medium">{formatCurrency(item.lineTotal)}</td></tr>)}</tbody>
      <tfoot><tr className="border-t font-medium"><td colSpan={3} className="px-4 py-2 text-right">Total</td><td className="px-4 py-2 text-right">{formatCurrency(q.total)}</td></tr></tfoot>
    </table></div>
  </div>
}
