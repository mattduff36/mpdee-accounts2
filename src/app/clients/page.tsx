import { prisma } from "@/lib/db"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/StatusBadge"
import Link from "next/link"
import { Search } from "lucide-react"
import { revalidatePath } from "next/cache"

async function getClients(search?: string, status?: string) {
  const where: any = {}
  if (status === "archived") where.isArchived = true
  else if (status === "active") where.isArchived = false
  if (search) where.OR = [{ name: { contains: search, mode: "insensitive" } }, { companyName: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }]
  const clients = await prisma.client.findMany({ where, orderBy: { name: "asc" }, include: { _count: { select: { invoices: true } } } })
  const invoiceBalances = await prisma.invoice.groupBy({ by: ["clientId"], where: { status: { in: ["sent", "viewed", "partial", "overdue"] } }, _sum: { balanceDue: true } })
  const balanceMap = Object.fromEntries(invoiceBalances.map(b => [b.clientId, b._sum.balanceDue || 0]))
  return clients.map(c => ({ ...c, outstandingBalance: balanceMap[c.id] || 0 }))
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ search?: string; status?: string }> }) {
  const sp = await searchParams
  const clients = await getClients(sp.search, sp.status)
  return <div className="space-y-4">
    <PageHeader title="Clients" description="Manage your clients and their billing information">
      <Link href="/clients/new"><Button>New Client</Button></Link>
    </PageHeader>
    <form className="flex gap-2">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input name="search" type="text" placeholder="Search clients..." defaultValue={sp.search} className="flex h-10 w-full rounded-md border border-gray-300 bg-white pl-10 pr-3 py-2 text-sm" />
      </div>
      <select name="status" defaultValue={sp.status || "all"} className="h-10 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
        <option value="all">All</option><option value="active">Active</option><option value="archived">Archived</option>
      </select>
      <Button type="submit" variant="secondary" size="sm">Filter</Button>
    </form>
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead><tr className="border-b bg-gray-50"><th className="px-4 py-3 text-left font-medium text-gray-500">Name</th><th className="px-4 py-3 text-left font-medium text-gray-500">Company</th><th className="px-4 py-3 text-left font-medium text-gray-500">Email</th><th className="px-4 py-3 text-right font-medium text-gray-500">Outstanding</th><th className="px-4 py-3 text-left font-medium text-gray-500">Status</th><th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th></tr></thead>
        <tbody>{clients.map(client => <tr key={client.id} className="border-b hover:bg-gray-50">
          <td className="px-4 py-3 font-medium"><Link href={`/clients/${client.id}`} className="text-blue-600 hover:underline">{client.name}</Link></td>
          <td className="px-4 py-3 text-gray-500">{client.companyName || "-"}</td>
          <td className="px-4 py-3 text-gray-500">{client.email || "-"}</td>
          <td className="px-4 py-3 text-right font-medium">{formatCurrency(client.outstandingBalance)}</td>
          <td className="px-4 py-3">{client.isArchived ? <StatusBadge status="cancelled" /> : <StatusBadge status="paid" />}</td>
          <td className="px-4 py-3 text-right"><Link href={`/clients/${client.id}/edit`}><Button variant="ghost" size="sm">Edit</Button></Link></td>
        </tr>)}</tbody>
      </table>
      {clients.length === 0 && <div className="py-8 text-center text-sm text-gray-500">No clients found</div>}
    </div>
  </div>
}
