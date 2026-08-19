import { prisma } from "@/lib/db"
import { formatCurrency, formatDate } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { PagedDataTable } from "@/components/PagedDataTable"
import { buildMonthTabs, groupByMonth, monthLabel, pluralize, resolveActiveMonth, sumBy } from "@/lib/monthly-list"
import { redirect } from "next/navigation"

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ importId: string; month?: string }>
}) {
  const { importId, month } = await searchParams
  const transactions = await prisma.bankTransaction.findMany({
    where: { bankImportId: importId },
    orderBy: { date: "desc" },
  })
  async function updateStatus(formData: FormData) {
    "use server"
    const id = String(formData.get("id"))
    const status = String(formData.get("status"))
    await prisma.bankTransaction.update({ where: { id }, data: { status, matchedAt: new Date() } })
    redirect(`/bank-import/preview?importId=${importId}${month ? `&month=${month}` : ""}`)
  }
  const groups = groupByMonth(transactions, (transaction) => transaction.date)
  const months = buildMonthTabs(groups, {
    includeCurrent: false,
    includeKeys: [month],
    preview: (items) => formatCurrency(sumBy(items, (item) => Math.abs(item.amount))),
  })
  const activeMonth = resolveActiveMonth(months.map((item) => item.key), month)
  const visible = groups.get(activeMonth) ?? []

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Import Preview</h1>
      <p className="text-sm text-gray-500">Review and categorise each transaction. Click an action to process.</p>
      <PagedDataTable
        path="/bank-import/preview"
        query={{ importId }}
        months={months}
        activeMonth={activeMonth}
        empty={transactions.length === 0 ? "No transactions" : `No transactions in ${monthLabel(activeMonth)}`}
        colSpan={5}
        header={
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Description</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Amount</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Actions</th>
          </tr>
        }
        subtotals={{
          label: `${monthLabel(activeMonth)} · ${pluralize(visible.length, "transaction")}`,
          items: [
            {
              label: "In",
              value: formatCurrency(sumBy(visible.filter((item) => item.amount > 0), (item) => item.amount)),
              tone: "success",
            },
            {
              label: "Out",
              value: formatCurrency(sumBy(visible.filter((item) => item.amount < 0), (item) => Math.abs(item.amount))),
              tone: "danger",
            },
          ],
        }}
      >
        {visible.map((transaction) => (
          <tr key={transaction.id} className="border-b hover:bg-gray-50">
            <td className="px-4 py-3">{formatDate(transaction.date)}</td>
            <td className="px-4 py-3">{transaction.description}</td>
            <td className="px-4 py-3 text-right font-medium" style={{ color: transaction.amount < 0 ? "#dc2626" : "#16a34a" }}>
              {formatCurrency(Math.abs(transaction.amount))}
            </td>
            <td className="px-4 py-3">
              <span className="text-xs capitalize">{transaction.status}</span>
            </td>
            <td className="px-4 py-3">
              <form action={updateStatus} className="flex gap-1">
                <input type="hidden" name="id" value={transaction.id} />
                <Button type="submit" name="status" value="expense" variant="secondary" size="sm">
                  Expense
                </Button>
                <Button type="submit" name="status" value="income" variant="secondary" size="sm">
                  Income
                </Button>
                <Button type="submit" name="status" value="transfer" variant="ghost" size="sm">
                  Transfer
                </Button>
                <Button type="submit" name="status" value="ignored" variant="ghost" size="sm">
                  Ignore
                </Button>
              </form>
            </td>
          </tr>
        ))}
      </PagedDataTable>
      <a href="/bank-import">
        <Button variant="secondary">Back to Imports</Button>
      </a>
    </div>
  )
}
