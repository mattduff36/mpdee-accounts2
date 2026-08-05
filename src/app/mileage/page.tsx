import { prisma } from "@/lib/db"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default async function MileagePage() {
  const records = await prisma.mileageExpense.findMany({ orderBy: { date: "desc" }, take: 100 })
  const totalMiles = records.reduce((s, r) => s + r.miles, 0)
  const totalAmount = records.reduce((s, r) => s + r.amount, 0)
  return <div className="space-y-4">
    <PageHeader title="Mileage" description="HMRC-compliant mileage tracking"><Link href="/mileage/new"><Button>Log Mileage</Button></Link></PageHeader>
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border bg-white p-4"><p className="text-sm text-gray-500">Total Miles</p><p className="text-2xl font-bold">{totalMiles.toFixed(1)}</p></div>
      <div className="rounded-lg border bg-white p-4"><p className="text-sm text-gray-500">Total Amount</p><p className="text-2xl font-bold">{formatCurrency(totalAmount)}</p></div>
    </div>
    <div className="rounded-lg border bg-white p-4 bg-blue-50"><p className="text-sm text-blue-800"><strong>HMRC Rates:</strong> 45p per mile for first 10,000 miles, 25p thereafter. Current rate used: 45p/mile</p></div>
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
        <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Description</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Route</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Miles</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Rate</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Amount</th>
      </tr></thead><tbody>{records.map(r => <tr key={r.id} className="border-b hover:bg-gray-50">
        <td className="px-4 py-3">{formatDate(r.date)}</td>
        <td className="px-4 py-3">{r.description}</td>
        <td className="px-4 py-3 text-gray-500">{r.startLocation && r.endLocation ? `${r.startLocation} → ${r.endLocation}` : "-"}</td>
        <td className="px-4 py-3 text-right">{r.miles}</td>
        <td className="px-4 py-3 text-right">{r.ratePerMile}p</td>
        <td className="px-4 py-3 text-right font-medium">{formatCurrency(r.amount)}</td>
      </tr>)}</tbody></table>
      {records.length === 0 && <div className="py-8 text-center text-sm text-gray-500">No mileage records</div>}
    </div>
  </div>
}
