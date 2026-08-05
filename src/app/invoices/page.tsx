import { prisma } from "@/lib/db"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/StatusBadge"
import Link from "next/link"
import { redirect } from "next/navigation"

async function getInvoices(status?: string, search?: string) {
  const where: any = {}
  if (status && status !== "all") where.status = status
  if (search) where.OR = [{ invoiceNumber: { contains: search, mode: "insensitive" } }, { client: { name: { contains: search, mode: "insensitive" } } }]
  return prisma.invoice.findMany({ where, orderBy: { createdAt: "desc" }, include: { client: { select: { name: true } }, _count: { select: { items: true } } } })
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; search?: string }> }) {
  const sp = await searchParams
  const invoices = await getInvoices(sp.status, sp.search)
  return <div className="space-y-4">
    <PageHeader title="Invoices" description="Manage invoices and track payments">
      <Link href="/invoices/new"><Button>New Invoice</Button></Link>
    </PageHeader>
    <form className="flex gap-2">
      <input name="search" type="text" placeholder="Search invoices..." defaultValue={sp.search} className="flex h-10 w-full max-w-sm rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" />
      <select name="status" defaultValue={sp.status || "all"} className="h-10 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
        <option value="all">All Status</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="viewed">Viewed</option><option value="partial">Partial</option><option value="paid">Paid</option><option value="overdue">Overdue</option><option value="cancelled">Cancelled</option>
      </select>
      <Button type="submit" variant="secondary" size="sm">Filter</Button>
    </form>
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
        <th className="px-4 py-3 text-left font-medium text-gray-500">Number</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Client</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Issue Date</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Due Date</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Total</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
      </tr></thead><tbody>{invoices.map(inv => <tr key={inv.id} className="border-b hover:bg-gray-50">
        <td className="px-4 py-3 font-medium"><Link href={`/invoices/${inv.id}`} className="text-blue-600 hover:underline">{inv.invoiceNumber}</Link></td>
        <td className="px-4 py-3">{inv.client.name}</td>
        <td className="px-4 py-3 text-gray-500">{formatDate(inv.issueDate)}</td>
        <td className="px-4 py-3 text-gray-500">{formatDate(inv.dueDate)}</td>
        <td className="px-4 py-3 text-right font-medium">{formatCurrency(inv.total)}</td>
        <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
        <td className="px-4 py-3 text-right">
          <form action={async () => { "use server"; await prisma.invoice.update({ where: { id: inv.id }, data: { status: "sent", sentAt: new Date() } }) }} className="inline"><Button type="submit" variant="ghost" size="sm">Mark Sent</Button></form>
          <Link href={`/invoices/${inv.id}`}><Button variant="ghost" size="sm">View</Button></Link>
        </td>
      </tr>)}</tbody></table>
      {invoices.length === 0 && <div className="py-8 text-center text-sm text-gray-500">No invoices found</div>}
    </div>
  </div>
}
