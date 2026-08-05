import { prisma } from "@/lib/db"
import { formatCurrency } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"

export default async function ClientRevenuePage() {
  const clients = await prisma.client.findMany({ where: { isArchived: false }, include: { invoices: true }, orderBy: { name: "asc" } })
  const data = clients.map(c => {
    const total = c.invoices.reduce((s, i) => s + i.total, 0)
    const paid = c.invoices.reduce((s, i) => s + i.amountPaid, 0)
    return { ...c, totalInvoiced: total, totalPaid: paid, outstanding: total - paid }
  }).sort((a, b) => b.totalInvoiced - a.totalInvoiced)
  return <div className="space-y-6">
    <PageHeader title="Client Revenue" />
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
        <th className="px-4 py-3 text-left font-medium text-gray-500">Client</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Invoiced</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Paid</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Outstanding</th>
      </tr></thead><tbody>{data.map(c => <tr key={c.id} className="border-b hover:bg-gray-50">
        <td className="px-4 py-3 font-medium">{c.name}</td>
        <td className="px-4 py-3 text-right font-medium">{formatCurrency(c.totalInvoiced)}</td>
        <td className="px-4 py-3 text-right text-green-600">{formatCurrency(c.totalPaid)}</td>
        <td className="px-4 py-3 text-right text-red-600">{formatCurrency(c.outstanding)}</td>
      </tr>)}</tbody></table>
      {data.length === 0 && <div className="py-8 text-center text-sm text-gray-500">No data</div>}
    </div>
  </div>
}
