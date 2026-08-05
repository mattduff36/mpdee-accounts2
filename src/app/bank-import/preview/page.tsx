import { prisma } from "@/lib/db"
import { formatCurrency, formatDate } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { redirect } from "next/navigation"

export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ importId: string }> }) {
  const { importId } = await searchParams
  const transactions = await prisma.bankTransaction.findMany({ where: { bankImportId: importId }, orderBy: { date: "desc" } })
  async function updateStatus(formData: FormData) {
    "use server"
    const id = String(formData.get("id"))
    const status = String(formData.get("status"))
    await prisma.bankTransaction.update({ where: { id }, data: { status, matchedAt: new Date() } })
    redirect(`/bank-import/preview?importId=${importId}`)
  }
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold">Import Preview</h1>
    <p className="text-sm text-gray-500">Review and categorise each transaction. Click an action to process.</p>
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
        <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Description</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Amount</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">Actions</th>
      </tr></thead><tbody>{transactions.map(t => <tr key={t.id} className="border-b hover:bg-gray-50">
        <td className="px-4 py-3">{formatDate(t.date)}</td>
        <td className="px-4 py-3">{t.description}</td>
        <td className="px-4 py-3 text-right font-medium" style={{ color: t.amount < 0 ? '#dc2626' : '#16a34a' }}>{formatCurrency(Math.abs(t.amount))}</td>
        <td className="px-4 py-3"><span className="text-xs capitalize">{t.status}</span></td>
        <td className="px-4 py-3">
          <form action={updateStatus} className="flex gap-1">
            <input type="hidden" name="id" value={t.id} />
            <Button type="submit" name="status" value="expense" variant="secondary" size="sm">Expense</Button>
            <Button type="submit" name="status" value="income" variant="secondary" size="sm">Income</Button>
            <Button type="submit" name="status" value="transfer" variant="ghost" size="sm">Transfer</Button>
            <Button type="submit" name="status" value="ignored" variant="ghost" size="sm">Ignore</Button>
          </form>
        </td>
      </tr>)}</tbody></table>
      {transactions.length === 0 && <div className="py-8 text-center text-sm text-gray-500">No transactions</div>}
    </div>
    <a href="/bank-import"><Button variant="secondary">Back to Imports</Button></a>
  </div>
}
