import { prisma } from "@/lib/db"
import { formatCurrency } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { startOfYear } from "@/lib/format"

export default async function ExpensesReportPage() {
  const yearStart = startOfYear(new Date())
  const expenses = await prisma.expense.groupBy({ by: ["categoryId"], where: { date: { gte: yearStart } }, _sum: { grossAmount: true } })
  const categories = await prisma.expenseCategory.findMany()
  const catMap = Object.fromEntries(categories.map(c => [c.id, c]))
  const data = expenses.map(e => ({ name: catMap[e.categoryId]?.name || "Unknown", amount: e._sum.grossAmount || 0, color: catMap[e.categoryId]?.color || "#999" })).sort((a, b) => b.amount - a.amount)
  const total = data.reduce((s, d) => s + d.amount, 0)
  return <div className="space-y-6">
    <PageHeader title="Expenses by Category" />
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
        <th className="px-4 py-3 text-left font-medium text-gray-500">Category</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Amount</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">%</th>
      </tr></thead><tbody>{data.map(d => <tr key={d.name} className="border-b hover:bg-gray-50">
        <td className="px-4 py-3"><span className="inline-block h-3 w-3 rounded-full mr-2" style={{ backgroundColor: d.color }} />{d.name}</td>
        <td className="px-4 py-3 text-right font-medium">{formatCurrency(d.amount)}</td>
        <td className="px-4 py-3 text-right text-gray-500">{total > 0 ? ((d.amount / total) * 100).toFixed(1) : 0}%</td>
      </tr>)}</tbody></table>
      {data.length === 0 && <div className="py-8 text-center text-sm text-gray-500">No data</div>}
    </div>
  </div>
}
