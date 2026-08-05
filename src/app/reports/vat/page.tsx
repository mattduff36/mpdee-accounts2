import { prisma } from "@/lib/db"
import { formatCurrency } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { startOfYear } from "@/lib/format"

export default async function VatReportPage() {
  const yearStart = startOfYear(new Date())
  const [outputVat, inputVat] = await Promise.all([
    prisma.invoice.aggregate({ _sum: { vatTotal: true }, where: { status: { not: "draft" }, issueDate: { gte: yearStart } } }),
    prisma.expense.aggregate({ _sum: { vatAmount: true }, where: { date: { gte: yearStart } } }),
  ])
  const output = outputVat._sum.vatTotal || 0
  const input = inputVat._sum.vatAmount || 0
  return <div className="space-y-6">
    <PageHeader title="VAT Summary" description="Year to date VAT position" />
    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-lg border bg-white p-6"><p className="text-sm text-gray-500">Output Tax (Sales)</p><p className="text-3xl font-bold">{formatCurrency(output)}</p></div>
      <div className="rounded-lg border bg-white p-6"><p className="text-sm text-gray-500">Input Tax (Purchases)</p><p className="text-3xl font-bold">{formatCurrency(input)}</p></div>
      <div className="rounded-lg border bg-white p-6"><p className="text-sm text-gray-500">Net VAT Due</p><p className={`text-3xl font-bold ${output - input >= 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(output - input)}</p></div>
    </div>
  </div>
}
