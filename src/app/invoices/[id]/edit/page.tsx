import { prisma } from "@/lib/db"
import { notFound, redirect } from "next/navigation"
import { NewInvoiceForm } from "@/components/NewInvoiceForm"
import { blankInvoiceLineItem } from "@/components/InvoiceLineItems"
import { formatIsoDateOnly } from "@/lib/invoice-date"
import { poundsInputFromPence, quantityInputFromValue } from "@/lib/invoice-items"
import {
  InvoiceEditError,
  draftInvoiceInputFromForm,
  invoiceEditErrorMessage,
  updateDraftInvoice,
} from "@/lib/update-draft-invoice"

export default async function EditInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const { error } = await searchParams
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  })
  if (!invoice) notFound()
  if (invoice.status !== "draft") redirect(`/invoices/${id}`)

  const clients = await prisma.client.findMany({
    where: { OR: [{ isArchived: false }, { id: invoice.clientId }] },
    orderBy: { name: "asc" },
  })

  async function saveDraft(formData: FormData) {
    "use server"
    try {
      await updateDraftInvoice(id, draftInvoiceInputFromForm(formData))
    } catch (caught) {
      if (caught instanceof InvoiceEditError) {
        if (caught.code === "not_found") redirect("/invoices")
        if (caught.redirectKey === "not-draft") redirect(`/invoices/${id}`)
        redirect(`/invoices/${id}/edit?error=${caught.redirectKey}`)
      }
      redirect(`/invoices/${id}/edit?error=save-failed`)
    }
    redirect("/invoices")
  }

  const items =
    invoice.items.length > 0
      ? invoice.items.map((item, index) => ({
          id: index,
          description: item.description,
          quantity: quantityInputFromValue(item.quantity),
          unitPrice: poundsInputFromPence(item.unitPrice),
          agencyCommission: String(item.agencyCommission || 0),
          businessArea: item.businessArea || "DEVELOPMENT",
        }))
      : [blankInvoiceLineItem(0)]

  return (
    <NewInvoiceForm
      title={`Edit Invoice ${invoice.invoiceNumber}`}
      submitLabel="Save Draft"
      cancelHref={`/invoices/${id}`}
      errorMessage={invoiceEditErrorMessage(error)}
      clients={clients.map((client) => ({ id: client.id, name: client.name }))}
      defaultPaymentTerms={invoice.paymentTerms}
      defaultIssueDate={formatIsoDateOnly(invoice.issueDate)}
      action={saveDraft}
      initial={{
        clientId: invoice.clientId,
        paymentTerms: String(invoice.paymentTerms),
        issueDate: formatIsoDateOnly(invoice.issueDate),
        dueDate: formatIsoDateOnly(invoice.dueDate),
        notes: invoice.notes || "",
        internalNotes: invoice.internalNotes || "",
        items,
        showAgency: invoice.items.some((item) => (item.agencyCommission || 0) > 0),
      }}
    />
  )
}
