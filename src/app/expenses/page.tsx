import { prisma } from "@/lib/db"
import { canWrite, requireAuth } from "@/lib/auth"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { buttonClass } from "@/app/costs/ui"
import { PagedDataTable } from "@/components/PagedDataTable"
import { currentMonthKey, isMonthKey, monthLabel, pluralize, LIST_PAGE_SIZE } from "@/lib/monthly-list"
import Link from "next/link"

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: { month?: string; page?: string }
}) {
  const user = await requireAuth()
  const writable = canWrite(user)
  const sp = await searchParams
  const activeMonth = isMonthKey(sp.month) && Number(sp.month.slice(5)) >= 1 && Number(sp.month.slice(5)) <= 12 ? sp.month : currentMonthKey()
  const [year, month] = activeMonth.split("-").map(Number)
  const date = { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) }
  // Aggregate history in Postgres; send only the current page's expense records.
  const summary = await prisma.$queryRaw<Array<{ month: string; count: number; gross: bigint }>>`
    SELECT to_char("date", 'YYYY-MM') AS month, count(*)::int AS count, sum("grossAmount")::bigint AS gross
    FROM "Expense" GROUP BY 1 ORDER BY 1 DESC
  `
  const byMonth = new Map(summary.map(row => [row.month, row]))
  const months = Array.from(new Set([...Array.from(byMonth.keys()), activeMonth, currentMonthKey()])).sort().reverse().map(key => ({
    key, label: monthLabel(key), count: byMonth.get(key)?.count ?? 0,
    preview: formatCurrency(Number(byMonth.get(key)?.gross ?? 0)),
  }))
  const total = byMonth.get(activeMonth)?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE))
  const requested = Number(sp.page)
  const page = Math.min(pageCount, Number.isSafeInteger(requested) && requested > 0 ? requested : 1)
  const [visible, sums] = await Promise.all([
    prisma.expense.findMany({ where: { date }, orderBy: [{ date: "desc" }, { id: "desc" }], skip: (page - 1) * LIST_PAGE_SIZE, take: LIST_PAGE_SIZE, include: { category: true, client: { select: { name: true } } } }),
    prisma.expense.aggregate({ where: { date }, _sum: { grossAmount: true, vatAmount: true, netAmount: true } }),
  ])
  const gross = sums._sum.grossAmount ?? 0, vat = sums._sum.vatAmount ?? 0, net = sums._sum.netAmount ?? 0

  return (
    <div className="space-y-4">
      <PageHeader title="Expenses" description="Track business expenses">
        {writable && <Link className={buttonClass} href="/expenses/new">New expense</Link>}
      </PageHeader>
      <p className="text-sm font-medium text-slate-600">{monthLabel(activeMonth)} · {pluralize(total, "expense")}</p>
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="min-w-0 rounded-2xl border border-blue-100 bg-blue-50/80 p-3 sm:p-4">
          <p className="text-sm text-gray-500">Gross</p>
          <p className="break-words text-lg font-bold tabular-nums sm:text-2xl">{formatCurrency(gross)}</p>
        </div>
        <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-100/80 p-3 sm:p-4">
          <p className="text-sm text-gray-500">VAT</p>
          <p className="break-words text-lg font-bold tabular-nums sm:text-2xl">{formatCurrency(vat)}</p>
        </div>
        <div className="min-w-0 rounded-2xl border border-teal-100 bg-teal-50/80 p-3 sm:p-4">
          <p className="text-sm text-gray-500">Net</p>
          <p className="break-words text-lg font-bold tabular-nums sm:text-2xl">{formatCurrency(net)}</p>
        </div>
      </div>
      <PagedDataTable
        path="/expenses"
        months={months}
        activeMonth={activeMonth}
        pagination={{ page, pageCount, total }}
        empty={summary.length === 0 ? "No expenses recorded" : `No expenses in ${monthLabel(activeMonth)}`}
        colSpan={7}
        mobileRows={<ul className="divide-y divide-slate-100">{visible.length ? visible.map(expense => <li key={expense.id} className="p-4">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-slate-950">{expense.supplier || expense.category.name}</p><p className="mt-1 text-xs text-slate-500">{formatDate(expense.date)}</p></div><p className="shrink-0 font-semibold tabular-nums">{formatCurrency(expense.grossAmount)}</p></div>
          <p className="mt-3 break-words text-sm leading-relaxed text-slate-700">{expense.description}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500"><span>{expense.category.name}</span><span>VAT {formatCurrency(expense.vatAmount)}</span><span>Net {formatCurrency(expense.netAmount)}</span></div>
          {(expense.notes || expense.reference) && <details className="mt-2 text-xs text-slate-600"><summary className="flex min-h-11 cursor-pointer items-center rounded font-semibold text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500">Source &amp; notes</summary><p className="whitespace-pre-wrap break-words leading-relaxed">{expense.reference}{expense.reference && '\n'}{expense.notes}</p></details>}
        </li>) : <li className="p-6 text-center text-sm text-slate-500">No expenses in {monthLabel(activeMonth)}</li>}</ul>}
        header={
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Category</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Supplier</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Description</th>
            <th className="whitespace-nowrap px-4 py-3 text-right font-medium text-gray-500">Net</th>
            <th className="whitespace-nowrap px-4 py-3 text-right font-medium text-gray-500">VAT</th>
            <th className="whitespace-nowrap px-4 py-3 text-right font-medium text-gray-500">Gross</th>
          </tr>
        }
        subtotals={{
          label: `${monthLabel(activeMonth)} · ${pluralize(total, "expense")}`,
          items: [
            { label: "Net", value: formatCurrency(net) },
            { label: "VAT", value: formatCurrency(vat) },
            { label: "Gross", value: formatCurrency(gross) },
          ],
        }}
      >
        {visible.map((expense) => (
          <tr key={expense.id} className="border-b hover:bg-gray-50">
            <td className="whitespace-nowrap px-4 py-3">{formatDate(expense.date)}</td>
            <td className="px-4 py-3">
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ backgroundColor: expense.category.color + "20", color: "#334155" }}
              >
                {expense.category.name}
              </span>
            </td>
            <td className="px-4 py-3">{expense.supplier || "-"}</td>
            <td className="min-w-48 max-w-md px-4 py-3"><p>{expense.description}</p>{expense.reference && <p className="mt-1 text-xs text-slate-500">{expense.reference}</p>}{expense.notes && <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer rounded py-1 font-medium text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500">Source &amp; notes</summary><p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{expense.notes}</p></details>}</td>
            <td className="whitespace-nowrap px-4 py-3 text-right">{formatCurrency(expense.netAmount)}</td>
            <td className="whitespace-nowrap px-4 py-3 text-right">{formatCurrency(expense.vatAmount)}</td>
            <td className="whitespace-nowrap px-4 py-3 text-right font-medium">{formatCurrency(expense.grossAmount)}</td>
          </tr>
        ))}
      </PagedDataTable>
    </div>
  )
}
