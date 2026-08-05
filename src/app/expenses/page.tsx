import { prisma } from "@/lib/db"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { startOfMonth, endOfMonth } from "@/lib/format"

async function getExpenses() {
  const now = new Date()
  const monthStart = startOfMonth(now)
  const monthEnd = endOfMonth(now)
  const [expenses, summary] = await Promise.all([
    prisma.expense.findMany({ orderBy: { date: "desc" }, include: { category: true, client: { select: { name: true } } }, take: 100 }),
    prisma.expense.aggregate({ where: { date: { gte: monthStart, lte: monthEnd } }, _sum: { grossAmount: true, vatAmount: true, netAmount: true } }),
  ])
  return { expenses, summary }
}

export default async function ExpensesPage() {
  const { expenses, summary } = await getExpenses()
  return <div className="space-y-4">
    <PageHeader title="Expenses" description="Track business expenses"><Link href="/expenses/new"><Button>New Expense</Button></Link></PageHeader>
    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-lg border bg-white p-4"><p className="text-sm text-gray-500">Gross (MTD)</p><p className="text-2xl font-bold">{formatCurrency(summary._sum.grossAmount)}</p></div>
      <div className="rounded-lg border bg-white p-4"><p className="text-sm text-gray-500">VAT (MTD)</p><p className="text-2xl font-bold">{formatCurrency(summary._sum.vatAmount)}</p></div>
      <div className="rounded-lg border bg-white p-4"><p className="text-sm text-gray-500">Net (MTD)</p><p className="text-2xl font-bold">{formatCurrency(summary._sum.netAmount)}</p></div>
    </div>
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
        <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Category</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Supplier</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Description</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Net</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">VAT</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Gross</th>
      </tr></thead><tbody>{expenses.map(e => <tr key={e.id} className="border-b hover:bg-gray-50">
        <td className="px-4 py-3">{formatDate(e.date)}</td>
        <td className="px-4 py-3"><span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: e.category.color + "20", color: e.category.color }}>{e.category.name}</span></td>
        <td className="px-4 py-3">{e.supplier || "-"}</td>
        <td className="px-4 py-3">{e.description}</td>
        <td className="px-4 py-3 text-right">{formatCurrency(e.netAmount)}</td>
        <td className="px-4 py-3 text-right">{formatCurrency(e.vatAmount)}</td>
        <td className="px-4 py-3 text-right font-medium">{formatCurrency(e.grossAmount)}</td>
      </tr>)}</tbody></table>
      {expenses.length === 0 && <div className="py-8 text-center text-sm text-gray-500">No expenses recorded</div>}
    </div>
  </div>
}
