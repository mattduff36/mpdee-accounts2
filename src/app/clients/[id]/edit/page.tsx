import { prisma } from "@/lib/db"
import { redirect, notFound } from "next/navigation"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const client = await prisma.client.findUnique({ where: { id } })
  if (!client) notFound()
  async function updateClient(formData: FormData) {
    "use server"
    await prisma.client.update({ where: { id }, data: {
      name: String(formData.get("name")),
      companyName: String(formData.get("companyName") || ""),
      email: String(formData.get("email") || ""),
      phone: String(formData.get("phone") || ""),
      addressLine1: String(formData.get("addressLine1") || ""),
      addressLine2: String(formData.get("addressLine2") || ""),
      city: String(formData.get("city") || ""),
      county: String(formData.get("county") || ""),
      postcode: String(formData.get("postcode") || ""),
      contactName: String(formData.get("contactName") || ""),
      vatNumber: String(formData.get("vatNumber") || ""),
      paymentTerms: Number(formData.get("paymentTerms") || 30),
      notes: String(formData.get("notes") || ""),
      isArchived: formData.get("isArchived") === "on",
    }})
    redirect("/clients")
  }
  return <div className="space-y-6 max-w-2xl">
    <PageHeader title={`Edit ${client.name}`} />
    <form action={updateClient} className="space-y-4 rounded-lg border bg-white p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label><Input name="name" defaultValue={client.name} required /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label><Input name="companyName" defaultValue={client.companyName || ""} /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Email</label><Input name="email" type="email" defaultValue={client.email || ""} /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone</label><Input name="phone" defaultValue={client.phone || ""} /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label><Input name="contactName" defaultValue={client.contactName || ""} /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">VAT Number</label><Input name="vatNumber" defaultValue={client.vatNumber || ""} /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Address Line 1</label><Input name="addressLine1" defaultValue={client.addressLine1 || ""} /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Address Line 2</label><Input name="addressLine2" defaultValue={client.addressLine2 || ""} /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">City</label><Input name="city" defaultValue={client.city || ""} /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">County</label><Input name="county" defaultValue={client.county || ""} /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Postcode</label><Input name="postcode" defaultValue={client.postcode || ""} /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms (days)</label><Input name="paymentTerms" type="number" defaultValue={client.paymentTerms} /></div>
      </div>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes</label><textarea name="notes" rows={3} className="flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" defaultValue={client.notes || ""} /></div>
      <div className="flex items-center gap-2"><input type="checkbox" name="isArchived" id="isArchived" defaultChecked={client.isArchived} className="rounded border-gray-300" /><label htmlFor="isArchived" className="text-sm text-gray-700">Archived</label></div>
      <div className="flex gap-2"><Button type="submit">Update Client</Button><a href="/clients"><Button type="button" variant="secondary">Cancel</Button></a></div>
    </form>
  </div>
}
