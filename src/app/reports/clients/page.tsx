import { prisma } from "@/lib/db"
import { andVisibleInvoice } from "@/lib/invoice-visibility"
import { formatCurrency } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { PagedDataTable } from "@/components/PagedDataTable"
import { pluralize, sumBy } from "@/lib/monthly-list"

export default async function ClientRevenuePage() {
  const clients = await prisma.client.findMany({
    where: { isArchived: false },
    include: { invoices: { where: andVisibleInvoice({ status: { notIn: ["draft", "cancelled"] } }) } },
    orderBy: { name: "asc" },
  })
  const data = clients
    .map((client) => {
      const total = client.invoices.reduce((sum, invoice) => sum + invoice.total, 0)
      const paid = client.invoices.reduce((sum, invoice) => sum + invoice.amountPaid, 0)
      return { ...client, totalInvoiced: total, totalPaid: paid, outstanding: client.invoices.filter(invoice => ["sent", "viewed", "partial", "overdue"].includes(invoice.status)).reduce((sum, invoice) => sum + invoice.balanceDue, 0) }
    })
    .sort((a, b) => b.totalInvoiced - a.totalInvoiced)

  return (
    <div className="space-y-6">
      <PageHeader title="Client invoicing" description="All-time issued invoices for active clients, including VAT. Drafts, cancelled and hidden invoices are excluded. Paid amounts are amounts recorded against these invoices; outstanding is the current balance." />
      <PagedDataTable
        empty="No data"
        colSpan={4}
        header={
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Client</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Invoiced</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Paid against invoices</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Outstanding</th>
          </tr>
        }
        subtotals={{
          label: pluralize(data.length, "client"),
          items: [
            { label: "Invoiced", value: formatCurrency(sumBy(data, (client) => client.totalInvoiced)) },
            { label: "Paid against invoices", value: formatCurrency(sumBy(data, (client) => client.totalPaid)), tone: "success" },
            { label: "Outstanding", value: formatCurrency(sumBy(data, (client) => client.outstanding)), tone: "danger" },
          ],
        }}
      >
        {data.map((client) => (
          <tr key={client.id} className="border-b hover:bg-gray-50">
            <td className="px-4 py-3 font-medium">{client.name}</td>
            <td className="px-4 py-3 text-right font-medium">{formatCurrency(client.totalInvoiced)}</td>
            <td className="px-4 py-3 text-right text-green-600">{formatCurrency(client.totalPaid)}</td>
            <td className="px-4 py-3 text-right text-red-600">{formatCurrency(client.outstanding)}</td>
          </tr>
        ))}
      </PagedDataTable>
    </div>
  )
}
