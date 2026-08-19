import { prisma } from "@/lib/db"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { PagedDataTable } from "@/components/PagedDataTable"
import { buildMonthTabs, groupByMonth, monthLabel, pluralize, resolveActiveMonth, sumBy } from "@/lib/monthly-list"
import Link from "next/link"

export default async function MileagePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const sp = await searchParams
  const records = await prisma.mileageExpense.findMany({ orderBy: { date: "desc" } })
  const groups = groupByMonth(records, (record) => record.date)
  const months = buildMonthTabs(groups, {
    includeKeys: [sp.month],
    preview: (items) => formatCurrency(sumBy(items, (item) => item.amount)),
  })
  const activeMonth = resolveActiveMonth(months.map((month) => month.key), sp.month)
  const visible = groups.get(activeMonth) ?? []
  const totalMiles = sumBy(visible, (record) => record.miles)
  const totalAmount = sumBy(visible, (record) => record.amount)

  return (
    <div className="space-y-4">
      <PageHeader title="Mileage" description="HMRC-compliant mileage tracking">
        <Link href="/mileage/new">
          <Button>Log Mileage</Button>
        </Link>
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">Miles ({monthLabel(activeMonth)})</p>
          <p className="text-2xl font-bold">{totalMiles.toFixed(1)}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm text-gray-500">Amount ({monthLabel(activeMonth)})</p>
          <p className="text-2xl font-bold">{formatCurrency(totalAmount)}</p>
        </div>
      </div>
      <div className="rounded-lg border bg-white p-4 bg-blue-50">
        <p className="text-sm text-blue-800">
          <strong>HMRC Rates:</strong> 45p per mile for first 10,000 miles, 25p thereafter. Current rate used: 45p/mile
        </p>
      </div>
      <PagedDataTable
        path="/mileage"
        months={months}
        activeMonth={activeMonth}
        empty={records.length === 0 ? "No mileage records" : `No mileage in ${monthLabel(activeMonth)}`}
        colSpan={6}
        header={
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Description</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Route</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Miles</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Rate</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Amount</th>
          </tr>
        }
        subtotals={{
          label: `${monthLabel(activeMonth)} · ${pluralize(visible.length, "trip")}`,
          items: [
            { label: "Miles", value: totalMiles.toFixed(1) },
            { label: "Amount", value: formatCurrency(totalAmount) },
          ],
        }}
      >
        {visible.map((record) => (
          <tr key={record.id} className="border-b hover:bg-gray-50">
            <td className="px-4 py-3">{formatDate(record.date)}</td>
            <td className="px-4 py-3">{record.description}</td>
            <td className="px-4 py-3 text-gray-500">
              {record.startLocation && record.endLocation ? `${record.startLocation} → ${record.endLocation}` : "-"}
            </td>
            <td className="px-4 py-3 text-right">{record.miles}</td>
            <td className="px-4 py-3 text-right">{record.ratePerMile}p</td>
            <td className="px-4 py-3 text-right font-medium">{formatCurrency(record.amount)}</td>
          </tr>
        ))}
      </PagedDataTable>
    </div>
  )
}
