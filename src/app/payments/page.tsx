import { prisma } from "@/lib/db"
import { visiblePaymentWhere } from "@/lib/invoice-visibility"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { PagedDataTable } from "@/components/PagedDataTable"
import { buildMonthTabs, groupByMonth, monthLabel, pluralize, resolveActiveMonth, sumBy } from "@/lib/monthly-list"
import Link from "next/link"

const signedAmount = (payment: { amount: number; isRefund: boolean }) => payment.isRefund ? -Math.abs(payment.amount) : payment.amount

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const sp = await searchParams
  const payments = await prisma.payment.findMany({
    where: visiblePaymentWhere,
    orderBy: { date: "desc" },
    include: { invoice: { select: { invoiceNumber: true, id: true } }, client: { select: { name: true } } },
  })
  const groups = groupByMonth(payments, (payment) => payment.date)
  const months = buildMonthTabs(groups, {
    includeKeys: [sp.month],
    preview: (items) => formatCurrency(sumBy(items, signedAmount)),
  })
  const activeMonth = resolveActiveMonth(months.map((month) => month.key), sp.month)
  const visible = groups.get(activeMonth) ?? []

  return (
    <div className="space-y-4">
      <PageHeader title="Payments" description="Recorded customer collections by payment date, including partial payments and refunds." />
      <PagedDataTable
        path="/payments"
        months={months}
        activeMonth={activeMonth}
        empty={payments.length === 0 ? "No payments recorded" : `No payments in ${monthLabel(activeMonth)}`}
        colSpan={6}
        header={
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Invoice</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Client</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Amount</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Method</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Reference</th>
          </tr>
        }
        subtotals={{
          label: `${monthLabel(activeMonth)} · ${pluralize(visible.length, "payment")}`,
          items: [{ label: "Net received after refunds", value: formatCurrency(sumBy(visible, signedAmount)), tone: sumBy(visible, signedAmount) >= 0 ? "success" : "danger" }],
        }}
      >
        {visible.map((payment) => (
          <tr key={payment.id} className="border-b hover:bg-gray-50">
            <td className="px-4 py-3">{formatDate(payment.date)}</td>
            <td className="px-4 py-3">
              {payment.invoice ? (
                <Link href={`/invoices/${payment.invoice.id}`} className="text-blue-600 hover:underline">
                  {payment.invoice.invoiceNumber}
                </Link>
              ) : (
                "-"
              )}
            </td>
            <td className="px-4 py-3">{payment.client?.name || "-"}</td>
            <td className={`px-4 py-3 text-right font-medium ${signedAmount(payment) < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatCurrency(signedAmount(payment))}{payment.isRefund && <span className="mt-1 block text-xs font-normal">Refund</span>}</td>
            <td className="px-4 py-3 capitalize">{payment.method.replace(/_/g, " ")}</td>
            <td className="px-4 py-3 text-gray-500">{payment.reference || "-"}</td>
          </tr>
        ))}
      </PagedDataTable>
    </div>
  )
}
