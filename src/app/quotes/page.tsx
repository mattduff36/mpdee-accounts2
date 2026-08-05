import { prisma } from "@/lib/db"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/StatusBadge"
import Link from "next/link"

export default async function QuotesPage() {
  const quotes = await prisma.quote.findMany({ orderBy: { createdAt: "desc" }, include: { client: { select: { name: true } } } })
  return <div className="space-y-4">
    <PageHeader title="Quotes" description="Manage quotes and estimates"><Link href="/quotes/new"><Button>New Quote</Button></Link></PageHeader>
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
        <th className="px-4 py-3 text-left font-medium text-gray-500">Number</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Client</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Expiry Date</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Total</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
      </tr></thead><tbody>{quotes.map(q => <tr key={q.id} className="border-b hover:bg-gray-50">
        <td className="px-4 py-3 font-medium"><Link href={`/quotes/${q.id}`} className="text-blue-600 hover:underline">{q.quoteNumber}</Link></td>
        <td className="px-4 py-3">{q.client.name}</td>
        <td className="px-4 py-3">{formatDate(q.expiryDate)}</td>
        <td className="px-4 py-3 text-right font-medium">{formatCurrency(q.total)}</td>
        <td className="px-4 py-3"><StatusBadge status={q.status} /></td>
      </tr>)}</tbody></table>
      {quotes.length === 0 && <div className="py-8 text-center text-sm text-gray-500">No quotes yet</div>}
    </div>
  </div>
}
