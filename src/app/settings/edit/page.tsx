import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { formatCurrency, formatDate } from "@/lib/format"
import { InvoiceHideEditor } from "./invoice-hide-editor"

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
    const updates = [
      ...(showIds.length > 0
        ? [prisma.invoice.updateMany({ where: { id: { in: showIds } }, data: { viewHidden: false } })]
        : []),
      ...(hideIds.length > 0
        ? [prisma.invoice.updateMany({ where: { id: { in: hideIds } }, data: { viewHidden: true } })]
        : []),
    ]
    if (updates.length > 0) await prisma.$transaction(updates)
    revalidatePath("/", "layout")
  }

  async function clearHidden() {
    "use server"
    await requireAuth()
    await prisma.invoice.updateMany({ data: { viewHidden: false } })
    revalidatePath("/", "layout")
  }

  return (
    <InvoiceHideEditor
      invoices={invoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.client.name,
        issued: formatDate(invoice.issueDate),
        total: formatCurrency(invoice.total),
        viewHidden: invoice.viewHidden,
      }))}
      saveHidden={saveHidden}
      clearHidden={clearHidden}
    />
  )
}
