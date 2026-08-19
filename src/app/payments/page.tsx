import { prisma } from "@/lib/db"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import Link from "next/link"

async function getPayments() { return prisma.payment.findMany({ orderBy: { date: "desc" }, include: { invoice: { select: { invoiceNumber: true, id: true } }, client: { select: { name: true } } } }) }

export default async function PaymentsPage() {
  const payments = await getPayments()
  return <div className="space-y-4">
    <PageHeader title="Payments" description="Track and manage payments" />
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
        <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Invoice</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Client</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Amount</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Method</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Reference</th>
      </tr></thead><tbody>{payments.map(p => <tr key={p.id} className="border-b hover:bg-gray-50">
        <td className="px-4 py-3">{formatDate(p.date)}</td>
        <td className="px-4 py-3">{p.invoice ? <Link href={`/invoices/${p.invoice.id}`} className="text-blue-600 hover:underline">{p.invoice.invoiceNumber}</Link> : "-"}</td>
        <td className="px-4 py-3">{p.client?.name || "-"}</td>
        <td className="px-4 py-3 text-right font-medium">{formatCurrency(p.amount)}</td>
        <td className="px-4 py-3 capitalize">{p.method.replace(/_/g, " ")}</td>
        <td className="px-4 py-3 text-gray-500">{p.reference || "-"}</td>
      </tr>)}</tbody></table>
      {payments.length === 0 && <div className="py-8 text-center text-sm text-gray-500">No payments recorded</div>}
    </div>
  </div>
}
