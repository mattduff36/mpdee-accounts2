import { prisma } from "@/lib/db"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/StatusBadge"
import { IconAction } from "@/components/IconAction"
import { PagedDataTable } from "@/components/PagedDataTable"
import { buildMonthTabs, groupByMonth, monthLabel, pluralize, resolveActiveMonth, sumBy } from "@/lib/monthly-list"
import { Eye } from "lucide-react"
import Link from "next/link"

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const sp = await searchParams
  const quotes = await prisma.quote.findMany({ orderBy: { createdAt: "desc" }, include: { client: { select: { name: true } } } })
  const groups = groupByMonth(quotes, (quote) => quote.issueDate)
  const months = buildMonthTabs(groups, {
    includeKeys: [sp.month],
    preview: (items) => formatCurrency(sumBy(items, (item) => item.total)),
  })
  const activeMonth = resolveActiveMonth(months.map((month) => month.key), sp.month)
  const visible = groups.get(activeMonth) ?? []

  return (
    <div className="space-y-4">
      <PageHeader title="Quotes" description="Manage quotes and estimates">
        <Link href="/quotes/new">
          <Button>New Quote</Button>
        </Link>
      </PageHeader>
      <PagedDataTable
        path="/quotes"
        months={months}
        activeMonth={activeMonth}
        empty={quotes.length === 0 ? "No quotes yet" : `No quotes in ${monthLabel(activeMonth)}`}
        colSpan={6}
        header={
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Number</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Client</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Expiry Date</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Total</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
          </tr>
        }
        subtotals={{
          label: `${monthLabel(activeMonth)} · ${pluralize(visible.length, "quote")}`,
          items: [{ label: "Quoted", value: formatCurrency(sumBy(visible, (item) => item.total)) }],
        }}
      >
        {visible.map((quote) => (
          <tr key={quote.id} className="border-b hover:bg-gray-50">
            <td className="px-4 py-3 font-medium">
              <Link href={`/quotes/${quote.id}`} className="text-blue-600 hover:underline">
                {quote.quoteNumber}
              </Link>
            </td>
            <td className="px-4 py-3">{quote.client.name}</td>
            <td className="px-4 py-3">{formatDate(quote.expiryDate)}</td>
            <td className="px-4 py-3 text-right font-medium">{formatCurrency(quote.total)}</td>
            <td className="px-4 py-3">
              <StatusBadge status={quote.status} />
            </td>
            <td className="px-4 py-3 text-right">
              <IconAction title="View Quote" icon={Eye} href={`/quotes/${quote.id}`} />
            </td>
          </tr>
        ))}
      </PagedDataTable>
    </div>
  )
}
