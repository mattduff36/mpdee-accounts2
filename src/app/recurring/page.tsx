import { prisma } from "@/lib/db"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { PagedDataTable } from "@/components/PagedDataTable"
import { pluralize, sumBy } from "@/lib/monthly-list"
import Link from "next/link"

export default async function RecurringPage() {
  const templates = await prisma.recurringInvoice.findMany({
    orderBy: { createdAt: "desc" },
    include: { client: { select: { name: true } } },
  })

  return (
    <div className="space-y-4">
      <PageHeader title="Recurring Invoices" description="Automated billing templates">
        <Link href="/recurring/new">
          <Button>New Template</Button>
        </Link>
      </PageHeader>
      <PagedDataTable
        empty="No recurring templates"
        colSpan={6}
        header={
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-3 text-left font-medium text-gray-500">Template</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Client</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Frequency</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Total</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Next Date</th>
          </tr>
        }
        subtotals={{
          label: pluralize(templates.length, "template"),
          items: [{ label: "Active value", value: formatCurrency(sumBy(templates.filter((template) => template.isActive), (template) => template.total)) }],
        }}
      >
        {templates.map((template) => (
          <tr key={template.id} className="border-b hover:bg-gray-50">
            <td className="px-4 py-3 font-medium">{template.templateName}</td>
            <td className="px-4 py-3">{template.client.name}</td>
            <td className="px-4 py-3 capitalize">{template.frequency}</td>
            <td className="px-4 py-3 text-right font-medium">{formatCurrency(template.total)}</td>
            <td className="px-4 py-3">
              {template.isActive ? (
                <span className="text-green-600 text-xs font-medium">Active</span>
              ) : (
                <span className="text-gray-500 text-xs">Inactive</span>
              )}
            </td>
            <td className="px-4 py-3">{template.nextIssueDate ? formatDate(template.nextIssueDate) : "-"}</td>
          </tr>
        ))}
      </PagedDataTable>
    </div>
  )
}
