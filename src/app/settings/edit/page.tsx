import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"

export default async function SettingsEditPage() {
  await requireAuth()
  const invoices = await prisma.invoice.findMany({
    orderBy: { issueDate: "desc" },
    include: { client: { select: { name: true } } },
  })

  async function saveHidden(formData: FormData) {
    "use server"
    await requireAuth()
    const listed = formData.getAll("invoiceId").map(String)
    const hidden = new Set(formData.getAll("hidden").map(String))
    const hideIds = listed.filter((id) => hidden.has(id))
    const showIds = listed.filter((id) => !hidden.has(id))
    await prisma.$transaction([
      prisma.invoice.updateMany({ where: { id: { in: showIds } }, data: { viewHidden: false } }),
      prisma.invoice.updateMany({ where: { id: { in: hideIds } }, data: { viewHidden: true } }),
    ])
    revalidatePath("/", "layout")
  }

  async function clearHidden() {
    "use server"
    await requireAuth()
    await prisma.invoice.updateMany({ data: { viewHidden: false } })
    revalidatePath("/", "layout")
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit"
        description="Tick invoices to hide them from the rest of the app. Hidden invoices stay hidden until you clear them."
      >
        <form action={clearHidden}>
          <Button type="submit" variant="secondary">
            Clear
          </Button>
        </form>
      </PageHeader>
      <form action={saveHidden} className="space-y-4">
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">Hide</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Invoice</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Client</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Issued</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No invoices
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b">
                    <td className="px-4 py-3">
                      <input type="hidden" name="invoiceId" value={invoice.id} />
                      <input
                        type="checkbox"
                        name="hidden"
                        value={invoice.id}
                        defaultChecked={invoice.viewHidden}
                        aria-label={`Hide ${invoice.invoiceNumber}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium">{invoice.invoiceNumber}</td>
                    <td className="px-4 py-3 text-gray-500">{invoice.client.name}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(invoice.issueDate)}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(invoice.total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Button type="submit">Save</Button>
      </form>
    </div>
  )
}
