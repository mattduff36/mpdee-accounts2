import Link from "next/link"
import { prisma } from "@/lib/db"
import { canWrite, requireAuth } from "@/lib/auth"
import { visibleInvoiceWhere, visiblePaymentWhere } from "@/lib/invoice-visibility"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { StatusBadge } from "@/components/StatusBadge"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { PagedDataTable } from "@/components/PagedDataTable"
import { notFound } from "next/navigation"
import { FileText, Mail, Phone, MapPin, Pencil } from "lucide-react"
import { IconAction } from "@/components/IconAction"
import { buildMonthTabs, groupByMonth, monthLabel, pluralize, resolveActiveMonth, sumBy } from "@/lib/monthly-list"

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const user = await requireAuth()
  const writable = canWrite(user)
  const { id } = await params
  const sp = await searchParams
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      invoices: { where: visibleInvoiceWhere, orderBy: { createdAt: "desc" } },
      payments: { where: visiblePaymentWhere, orderBy: { date: "desc" } },
    },
  })
  if (!client) notFound()
  const issuedInvoices = client.invoices.filter((invoice) => !["draft", "cancelled"].includes(invoice.status))
  const totalInvoiced = issuedInvoices.reduce((sum, invoice) => sum + invoice.total, 0)
  const totalPaid = issuedInvoices.reduce((sum, invoice) => sum + invoice.amountPaid, 0)
  const outstanding = client.invoices
    .filter((invoice) => ["sent", "viewed", "partial", "overdue"].includes(invoice.status))
    .reduce((sum, invoice) => sum + invoice.balanceDue, 0)
  const groups = groupByMonth(client.invoices, (invoice) => invoice.issueDate)
  const months = buildMonthTabs(groups, {
    includeCurrent: false,
    includeKeys: [sp.month],
    preview: (items) => formatCurrency(sumBy(items.filter((item) => !["draft", "cancelled"].includes(item.status)), (item) => item.total)),
  })
  const activeMonth = resolveActiveMonth(months.map((month) => month.key), sp.month)
  const visible = groups.get(activeMonth) ?? []

  return (
    <div className="space-y-6">
      <PageHeader title={client.name} description={client.companyName || undefined}>
        {writable && <IconAction title="Edit Client" icon={Pencil} href={`/clients/${id}/edit`} />}
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Issued invoices</p>
            <p className="text-2xl font-bold">{formatCurrency(totalInvoiced)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Paid against issued invoices</p>
            <p className="text-2xl font-bold text-green-600">{formatCurrency(totalPaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Outstanding</p>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(outstanding)}</p>
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-slate-500">Totals include VAT and exclude draft and cancelled invoices. All invoice statuses remain visible below for reference.</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {client.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-gray-400" />
                {client.email}
              </div>
            )}
            {client.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-gray-400" />
                {client.phone}
              </div>
            )}
            {(client.addressLine1 || client.city) && (
              <div className="flex items-start gap-2 text-sm">
                <MapPin className="h-4 w-4 text-gray-400 mt-0.5" />
                <span>
                  {[client.addressLine1, client.addressLine2, client.city, client.county, client.postcode]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </div>
            )}
            {client.vatNumber && <p className="text-sm text-gray-500">VAT: {client.vatNumber}</p>}
            {client.notes && <p className="text-sm text-gray-500 mt-2">{client.notes}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Invoices
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            <PagedDataTable
              framed={false}
              path={`/clients/${id}`}
              months={months}
              activeMonth={activeMonth}
              empty={client.invoices.length === 0 ? "No invoices" : `No invoices in ${monthLabel(activeMonth)}`}
              colSpan={3}
              header={
                <tr className="border-b bg-gray-50">
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Invoice</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Total</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Status</th>
                </tr>
              }
              subtotals={
                visible.length > 0
                  ? {
                      label: `${monthLabel(activeMonth)} · ${pluralize(visible.length, "invoice")}`,
                      items: [{ label: "Invoiced", value: formatCurrency(sumBy(visible.filter((item) => !["draft", "cancelled"].includes(item.status)), (item) => item.total)) }],
                    }
                  : undefined
              }
            >
              {visible.map((invoice) => (
                <tr key={invoice.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${invoice.id}`} className="text-sm font-medium text-blue-700 hover:underline">{invoice.invoiceNumber}</Link>
                    <p className="text-xs text-gray-500">{formatDate(invoice.issueDate)}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-medium">{formatCurrency(invoice.total)}</td>
                  <td className="px-4 py-3 text-right">
                    <StatusBadge status={invoice.status} />
                  </td>
                </tr>
              ))}
            </PagedDataTable>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
