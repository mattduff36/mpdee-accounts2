import { prisma } from "@/lib/db"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { PagedDataTable } from "@/components/PagedDataTable"
import { buildMonthTabs, groupByMonth, monthLabel, pluralize, resolveActiveMonth, sumBy } from "@/lib/monthly-list"
import Link from "next/link"

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const sp = await searchParams
  const expenses = await prisma.expense.findMany({
    orderBy: { date: "desc" },
    include: { category: true, client: { select: { name: true } } },
  })
  const groups = groupByMonth(expenses, (expense) => expense.date)
  const months = buildMonthTabs(groups, {
    includeKeys: [sp.month],
    preview: (items) => formatCurrency(sumBy(items, (item) => item.grossAmount)),
  })
  const activeMonth = resolveActiveMonth(months.map((month) => month.key), sp.month)
  const visible = groups.get(activeMonth) ?? []
  const gross = sumBy(visible, (item) => item.grossAmount)
  const vat = sumBy(visible, (item) => item.vatAmount)
  const net = sumBy(visible, (item) => item.netAmount)

  return (
    <div className="space-y-4">
      <PageHeader title="Expenses" description="Track business expenses">
        <Link href="/expenses/new">
          <Button>New Expense</Button>
        </Link>
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">Gross ({monthLabel(activeMonth)})</p>
          <p className="text-2xl font-bold">{formatCurrency(gross)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">VAT ({monthLabel(activeMonth)})</p>
          <p className="text-2xl font-bold">{formatCurrency(vat)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">Net ({monthLabel(activeMonth)})</p>
          <p className="text-2xl font-bold">{formatCurrency(net)}</p>
        </div>
      </div>
      <PagedDataTable
        path="/expenses"
        months={months}
        activeMonth={activeMonth}
        empty={expenses.length === 0 ? "No expenses recorded" : `No expenses in ${monthLabel(activeMonth)}`}
        colSpan={7}
        header={
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Category</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Supplier</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Description</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Net</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">VAT</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Gross</th>
          </tr>
        }
        subtotals={{
          label: `${monthLabel(activeMonth)} · ${pluralize(visible.length, "expense")}`,
          items: [
            { label: "Net", value: formatCurrency(net) },
            { label: "VAT", value: formatCurrency(vat) },
            { label: "Gross", value: formatCurrency(gross) },
          ],
        }}
      >
        {visible.map((expense) => (
          <tr key={expense.id} className="border-b hover:bg-gray-50">
            <td className="px-4 py-3">{formatDate(expense.date)}</td>
            <td className="px-4 py-3">
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ backgroundColor: expense.category.color + "20", color: expense.category.color }}
              >
                {expense.category.name}
              </span>
            </td>
            <td className="px-4 py-3">{expense.supplier || "-"}</td>
            <td className="px-4 py-3">{expense.description}</td>
            <td className="px-4 py-3 text-right">{formatCurrency(expense.netAmount)}</td>
            <td className="px-4 py-3 text-right">{formatCurrency(expense.vatAmount)}</td>
            <td className="px-4 py-3 text-right font-medium">{formatCurrency(expense.grossAmount)}</td>
          </tr>
        ))}
      </PagedDataTable>
    </div>
  )
}
