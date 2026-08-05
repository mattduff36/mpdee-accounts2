import { prisma } from "@/lib/db"
import { formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { redirect } from "next/navigation"

export default async function BankImportPage() {
  const imports = await prisma.bankImport.findMany({ orderBy: { importDate: "desc" }, take: 20 })
  async function uploadCSV(formData: FormData) {
    "use server"
    const file = formData.get("file") as File
    if (!file) return
    const text = await file.text()
    const lines = text.split("\n").filter(l => l.trim())
    if (lines.length < 2) return
    const bankImport = await prisma.bankImport.create({ data: { fileName: file.name, rowCount: lines.length - 1 } })
    const headers = lines[0].split(",").map(h => h.trim().toLowerCase())
    const dateIdx = headers.findIndex(h => h.includes("date"))
    const descIdx = headers.findIndex(h => h.includes("desc") || h.includes("narrative") || h.includes("details"))
    const amtIdx = headers.findIndex(h => h.includes("amount") || h.includes("value"))
    const refIdx = headers.findIndex(h => h.includes("ref") || h.includes("type"))
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""))
      if (cols.length < 2) continue
      const amountStr = amtIdx >= 0 ? cols[amtIdx] : "0"
      const amount = Math.round(parseFloat(amountStr.replace(/[^0-9.-]/g, "")) * 100)
      await prisma.bankTransaction.create({ data: {
        bankImportId: bankImport.id,
        date: dateIdx >= 0 && cols[dateIdx] ? new Date(cols[dateIdx]) : new Date(),
        description: descIdx >= 0 ? cols[descIdx] : cols[1] || "Transaction",
        reference: refIdx >= 0 ? cols[refIdx] : "",
        amount,
        type: amount < 0 ? "debit" : "credit",
      }})
    }
    redirect("/bank-import/preview?importId=" + bankImport.id)
  }
  return <div className="space-y-6">
    <PageHeader title="Bank Import" description="Import and categorise bank statement CSV files" />
    <Card><CardHeader><CardTitle>Upload CSV</CardTitle></CardHeader><CardContent>
      <form action={uploadCSV} className="space-y-4">
        <p className="text-sm text-gray-500">Upload a CSV file from your bank. Common UK formats supported: Barclays, HSBC, Lloyds, NatWest, Santander.</p>
        <input name="file" type="file" accept=".csv" required className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100" />
        <Button type="submit">Upload & Preview</Button>
      </form>
    </CardContent></Card>
    <h2 className="text-lg font-semibold">Import History</h2>
    <div className="rounded-lg border bg-white">
      <table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
        <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
        <th className="px-4 py-3 text-left font-medium text-gray-500">File</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Rows</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Matched</th>
        <th className="px-4 py-3 text-right font-medium text-gray-500">Ignored</th>
      </tr></thead><tbody>{imports.map(imp => <tr key={imp.id} className="border-b hover:bg-gray-50">
        <td className="px-4 py-3">{formatDate(imp.importDate)}</td>
        <td className="px-4 py-3">{imp.fileName}</td>
        <td className="px-4 py-3 text-right">{imp.rowCount}</td>
        <td className="px-4 py-3 text-right">{imp.matchedCount}</td>
        <td className="px-4 py-3 text-right">{imp.ignoredCount}</td>
      </tr>)}</tbody></table>
      {imports.length === 0 && <div className="py-8 text-center text-sm text-gray-500">No imports yet</div>}
    </div>
  </div>
}
