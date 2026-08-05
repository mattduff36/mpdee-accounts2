import { prisma } from "@/lib/db"
import { formatCurrency } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { startOfYear } from "@/lib/format"

export default async function SalesReportPage() {
  const yearStart = startOfYear(new Date())
  const invoices = await prisma.invoice.findMany({ where: { issueDate: { gte: yearStart } }, orderBy: { issueDate: "asc" } })
  const monthly: Record<string, { issued: number; paid: number }> = {}
  for (const inv of invoices) {
    const key = inv.issueDate.toISOString().slice(0, 7)
    if (!monthly[key]) monthly[key] = { issued: 0, paid: 0 }
    monthly[key].issued += inv.total
    if (inv.status === "paid") monthly[key].paid += inv.total
  }
  const months = Object.entries(monthly).sort()
  return <div className="space-y-6">
    <PageHeader title="Sales by Month" />
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
        <th className="px-4 py-3 text-left font-medium text-gray-500">Month</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Invoiced</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Paid</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Outstanding</th>
      </tr></thead><tbody>{months.map(([month, data]) => <tr key={month} className="border-b hover:bg-gray-50">
        <td className="px-4 py-3 font-medium">{month}</td>
        <td className="px-4 py-3 text-right">{formatCurrency(data.issued)}</td>
        <td className="px-4 py-3 text-right text-green-600">{formatCurrency(data.paid)}</td>
        <td className="px-4 py-3 text-right text-red-600">{formatCurrency(data.issued - data.paid)}</td>
      </tr>)}</tbody></table>
      {months.length === 0 && <div className="py-8 text-center text-sm text-gray-500">No data</div>}
    </div>
  </div>
}
