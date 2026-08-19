import { prisma } from "@/lib/db"
import { formatCurrency, formatDate } from "@/lib/format"
import { invoiceSendMode, isEligibleMarkPaidStatus } from "@/lib/payments"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/StatusBadge"
import { IconAction } from "@/components/IconAction"
import { MarkAsPaidButton } from "@/components/MarkAsPaidButton"
import { SendInvoiceButton } from "@/components/SendInvoiceButton"
import { PagedDataTable } from "@/components/PagedDataTable"
import { buildMonthTabs, groupByMonth, monthLabel, pluralize, resolveActiveMonth, sumBy } from "@/lib/monthly-list"
import { Download, Eye, Pencil } from "lucide-react"
import Link from "next/link"

async function getInvoices(status?: string, search?: string) {
  const where: Record<string, unknown> = {}
  if (status && status !== "all") where.status = status
  if (search)
    where.OR = [
      { invoiceNumber: { contains: search, mode: "insensitive" } },
      { client: { name: { contains: search, mode: "insensitive" } } },
    ]
  return prisma.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { client: { select: { name: true } }, _count: { select: { items: true } } },
  })
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string; month?: string }>
}) {
  const sp = await searchParams
  const invoices = await getInvoices(sp.status, sp.search)
  const groups = groupByMonth(invoices, (invoice) => invoice.issueDate)
  const months = buildMonthTabs(groups, {
    includeKeys: [sp.month],
    preview: (items) => formatCurrency(sumBy(items, (item) => item.total)),
  })
  const activeMonth = resolveActiveMonth(months.map((month) => month.key), sp.month)
  const visible = groups.get(activeMonth) ?? []
  const query = { status: sp.status, search: sp.search }

  return (
    <div className="space-y-4">
      <PageHeader title="Invoices" description="Manage invoices and track payments">
        <Link href="/invoices/new">
          <Button>New Invoice</Button>
        </Link>
      </PageHeader>
      <form className="flex gap-2">
        {sp.month && <input type="hidden" name="month" value={sp.month} />}
        <input
          name="search"
          type="text"
          placeholder="Search invoices..."
          defaultValue={sp.search}
          className="flex h-10 w-full max-w-sm rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
        />
        <select
          name="status"
          defaultValue={sp.status || "all"}
          className="h-10 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="all">All Status</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="viewed">Viewed</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <Button type="submit" variant="secondary" size="sm">
          Filter
        </Button>
      </form>
      <PagedDataTable
        path="/invoices"
        query={query}
        months={months}
        activeMonth={activeMonth}
        empty={invoices.length === 0 ? "No invoices found" : `No invoices in ${monthLabel(activeMonth)}`}
        colSpan={7}
        header={
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Number</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Client</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Issue Date</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Due Date</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Total</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
          </tr>
        }
        subtotals={{
          label: `${monthLabel(activeMonth)} · ${pluralize(visible.length, "invoice")}`,
          items: [
            { label: "Invoiced", value: formatCurrency(sumBy(visible, (item) => item.total)) },
            { label: "Paid", value: formatCurrency(sumBy(visible, (item) => item.amountPaid)), tone: "success" },
            { label: "Due", value: formatCurrency(sumBy(visible, (item) => item.balanceDue)), tone: "danger" },
          ],
        }}
      >
        {visible.map((inv) => {
          const sendMode = invoiceSendMode(inv.status)
          return (
            <tr key={inv.id} className="border-b hover:bg-gray-50">
              <td className="px-4 py-3 font-medium">
                <Link href={`/invoices/${inv.id}`} className="text-blue-600 hover:underline">
                  {inv.invoiceNumber}
                </Link>
              </td>
              <td className="px-4 py-3">{inv.client.name}</td>
              <td className="px-4 py-3 text-gray-500">{formatDate(inv.issueDate)}</td>
              <td className="px-4 py-3 text-gray-500">{formatDate(inv.dueDate)}</td>
              <td className="px-4 py-3 text-right font-medium">{formatCurrency(inv.total)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={inv.status} />
              </td>
              <td className="px-4 py-3 text-right">
                <div className="inline-flex items-center justify-end gap-1">
                  {inv.status === "draft" && (
                    <IconAction title="Edit Invoice" icon={Pencil} href={`/invoices/${inv.id}/edit`} />
                  )}
                  {sendMode && <SendInvoiceButton invoiceId={inv.id} mode={sendMode} />}
                  {isEligibleMarkPaidStatus(inv.status) && <MarkAsPaidButton invoiceId={inv.id} />}
                  <IconAction title="Download PDF" icon={Download} tone="blue" href={`/api/invoices/${inv.id}/pdf`} external />
                  <IconAction title="View Invoice" icon={Eye} href={`/invoices/${inv.id}`} />
                </div>
              </td>
            </tr>
          )
        })}
      </PagedDataTable>
    </div>
  )
}
