import { prisma } from "@/lib/db"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default async function RecurringPage() {
  const templates = await prisma.recurringInvoice.findMany({ orderBy: { createdAt: "desc" }, include: { client: { select: { name: true } } } })
  return <div className="space-y-4">
    <PageHeader title="Recurring Invoices" description="Automated billing templates"><Link href="/recurring/new"><Button>New Template</Button></Link></PageHeader>
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
        <th className="px-4 py-3 text-left font-medium text-gray-500">Template</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Client</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Frequency</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Total</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Next Date</th>
      </tr></thead><tbody>{templates.map(t => <tr key={t.id} className="border-b hover:bg-gray-50">
        <td className="px-4 py-3 font-medium">{t.templateName}</td>
        <td className="px-4 py-3">{t.client.name}</td>
        <td className="px-4 py-3 capitalize">{t.frequency}</td>
        <td className="px-4 py-3 text-right font-medium">{formatCurrency(t.total)}</td>
        <td className="px-4 py-3">{t.isActive ? <span className="text-green-600 text-xs font-medium">Active</span> : <span className="text-gray-500 text-xs">Inactive</span>}</td>
        <td className="px-4 py-3">{t.nextIssueDate ? formatDate(t.nextIssueDate) : "-"}</td>
      </tr>)}</tbody></table>
      {templates.length === 0 && <div className="py-8 text-center text-sm text-gray-500">No recurring templates</div>}
    </div>
  </div>
}
