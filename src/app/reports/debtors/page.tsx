import { prisma } from "@/lib/db"
import { formatCurrency, formatDate, daysOverdue } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { PagedDataTable } from "@/components/PagedDataTable"
import { buildMonthTabs, groupByMonth, monthLabel, pluralize, resolveActiveMonth, sumBy } from "@/lib/monthly-list"

export default async function DebtorsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const sp = await searchParams
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ["sent", "viewed", "partial", "overdue"] } },
    include: { client: { select: { name: true } } },
    orderBy: { dueDate: "asc" },
  })
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 }
  for (const inv of invoices) {
    const days = daysOverdue(inv.dueDate)
    if (days === 0 && inv.status !== "overdue") buckets.current += inv.balanceDue
    else if (days <= 30) buckets.d30 += inv.balanceDue
    else if (days <= 60) buckets.d60 += inv.balanceDue
    else if (days <= 90) buckets.d90 += inv.balanceDue
    else buckets.d90plus += inv.balanceDue
  }
  const groups = groupByMonth(invoices, (invoice) => invoice.dueDate)
  const months = buildMonthTabs(groups, {
    includeCurrent: false,
    includeKeys: [sp.month],
    preview: (items) => formatCurrency(sumBy(items, (item) => item.balanceDue)),
  })
  const activeMonth = resolveActiveMonth(months.map((month) => month.key), sp.month)
  const visible = groups.get(activeMonth) ?? []

  return (
    <div className="space-y-6">
      <PageHeader title="Aged Debtors" description="Outstanding invoices by age" />
      <div className="grid gap-4 md:grid-cols-5">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">Current</p>
          <p className="text-xl font-bold">{formatCurrency(buckets.current)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">1-30 days</p>
          <p className="text-xl font-bold">{formatCurrency(buckets.d30)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">31-60 days</p>
          <p className="text-xl font-bold">{formatCurrency(buckets.d60)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">61-90 days</p>
          <p className="text-xl font-bold">{formatCurrency(buckets.d90)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">90+ days</p>
          <p className="text-xl font-bold text-red-600">{formatCurrency(buckets.d90plus)}</p>
        </div>
      </div>
      <PagedDataTable
        path="/reports/debtors"
        months={months}
        activeMonth={activeMonth}
        empty={invoices.length === 0 ? "No outstanding invoices" : `No outstanding invoices due in ${monthLabel(activeMonth)}`}
        colSpan={5}
        header={
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Invoice</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Client</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Due Date</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Days Overdue</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Balance</th>
          </tr>
        }
        subtotals={{
          label: `${monthLabel(activeMonth)} · ${pluralize(visible.length, "invoice")}`,
          items: [{ label: "Due", value: formatCurrency(sumBy(visible, (item) => item.balanceDue)), tone: "danger" }],
        }}
      >
        {visible.map((inv) => (
          <tr key={inv.id} className="border-b hover:bg-gray-50">
            <td className="px-4 py-3 font-medium">{inv.invoiceNumber}</td>
            <td className="px-4 py-3">{inv.client.name}</td>
            <td className="px-4 py-3">{formatDate(inv.dueDate)}</td>
            <td className="px-4 py-3 text-right">{daysOverdue(inv.dueDate)}</td>
            <td className="px-4 py-3 text-right font-medium">{formatCurrency(inv.balanceDue)}</td>
          </tr>
        ))}
      </PagedDataTable>
    </div>
  )
}
