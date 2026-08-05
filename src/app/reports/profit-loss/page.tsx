import { prisma } from "@/lib/db"
import { formatCurrency } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { startOfYear, endOfYear } from "@/lib/format"

export default async function ProfitLossPage() {
  const now = new Date()
  const ys = startOfYear(now)
  const ye = endOfYear(now)
  const revenue = await prisma.invoice.aggregate({ _sum: { total: true }, where: { status: "paid", paidAt: { gte: ys, lte: ye } } })
  const expenses = await prisma.expense.aggregate({ _sum: { grossAmount: true }, where: { date: { gte: ys, lte: ye } } })
  const rev = revenue._sum.total || 0
  const exp = expenses._sum.grossAmount || 0
  return <div className="space-y-6">
    <PageHeader title="Profit & Loss" description={`Year to date: ${ys.getFullYear()}`} />
    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-lg border bg-white p-6"><p className="text-sm text-gray-500">Revenue</p><p className="text-3xl font-bold text-green-600">{formatCurrency(rev)}</p></div>
      <div className="rounded-lg border bg-white p-6"><p className="text-sm text-gray-500">Expenses</p><p className="text-3xl font-bold text-red-600">{formatCurrency(exp)}</p></div>
      <div className="rounded-lg border bg-white p-6"><p className="text-sm text-gray-500">Net Profit</p><p className={`text-3xl font-bold ${rev - exp >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(rev - exp)}</p></div>
    </div>
  </div>
}
