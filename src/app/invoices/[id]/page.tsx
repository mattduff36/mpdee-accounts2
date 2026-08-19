import { prisma } from "@/lib/db"
import { formatCurrency, formatDate, daysOverdue } from "@/lib/format"
import { invoiceSendMode, isEligibleMarkPaidStatus } from "@/lib/payments"
import { PageHeader } from "@/components/PageHeader"
import { StatusBadge } from "@/components/StatusBadge"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { IconAction } from "@/components/IconAction"
import { MarkAsPaidButton } from "@/components/MarkAsPaidButton"
import { SendInvoiceButton } from "@/components/SendInvoiceButton"
import { Download, Pencil } from "lucide-react"
import { notFound } from "next/navigation"

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { client: true, items: { orderBy: { sortOrder: "asc" } }, payments: { orderBy: { date: "desc" } } },
  })
  if (!invoice) notFound()
  const sendMode = invoiceSendMode(invoice.status)
  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader title={`Invoice ${invoice.invoiceNumber}`}>
        <div className="flex gap-1 flex-wrap">
          {invoice.status === "draft" && (
            <IconAction title="Edit Invoice" icon={Pencil} href={`/invoices/${id}/edit`} />
          )}
          {sendMode && <SendInvoiceButton invoiceId={id} mode={sendMode} />}
          {isEligibleMarkPaidStatus(invoice.status) && <MarkAsPaidButton invoiceId={id} />}
          <IconAction title="Download PDF" icon={Download} tone="blue" href={`/api/invoices/${id}/pdf`} external />
        </div>
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Total</p>
            <p className="text-2xl font-bold">{formatCurrency(invoice.total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Amount Paid</p>
            <p className="text-2xl font-bold text-green-600">{formatCurrency(invoice.amountPaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-gray-500">Balance Due</p>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(invoice.balanceDue)}</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Invoice Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-gray-500">Client</p>
              <p className="font-medium">{invoice.client.name}</p>
              {invoice.client.companyName && <p className="text-gray-500">{invoice.client.companyName}</p>}
            </div>
            <div>
              <p className="text-gray-500">Status</p>
              <StatusBadge status={invoice.status} />
            </div>
            <div>
              <p className="text-gray-500">Issue Date</p>
              <p>{formatDate(invoice.issueDate)}</p>
            </div>
            <div>
              <p className="text-gray-500">Due Date</p>
              <p>
                {formatDate(invoice.dueDate)}{" "}
                {invoice.status !== "paid" &&
                  invoice.status !== "draft" &&
                  invoice.dueDate < new Date() && (
                    <span className="text-red-600">({daysOverdue(invoice.dueDate)} days overdue)</span>
                  )}
              </p>
            </div>
            <div>
              <p className="text-gray-500">Payment Terms</p>
              <p>{invoice.paymentTerms} days</p>
            </div>
          </div>
          {invoice.notes && (
            <div className="mt-4">
              <p className="text-gray-500">Notes</p>
              <p>{invoice.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-2 text-left">Description</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Rate</th>
                <th className="px-4 py-2 text-right">Agency %</th>
                <th className="px-4 py-2 text-right">Area</th>
                <th className="px-4 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="px-4 py-2">{item.description}</td>
                  <td className="px-4 py-2 text-right">{item.quantity}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                  <td className="px-4 py-2 text-right">{item.agencyCommission || 0}</td>
                  <td className="px-4 py-2 text-right">{item.businessArea}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatCurrency(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-lg font-bold border-t">
                <td colSpan={5} className="px-4 py-2 text-right">
                  Total
                </td>
                <td className="px-4 py-2 text-right">{formatCurrency(invoice.total)}</td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>
      {invoice.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {invoice.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">{formatCurrency(p.amount)}</p>
                    <p className="text-xs text-gray-500">
                      {formatDate(p.date)} - {p.method.replace(/_/g, " ")}
                    </p>
                  </div>
                  {p.reference && <p className="text-xs text-gray-500">Ref: {p.reference}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
