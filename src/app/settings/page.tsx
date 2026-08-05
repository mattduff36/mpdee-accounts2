import { prisma } from "@/lib/db"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import Link from "next/link"

export default async function SettingsPage() {
  const settings = await prisma.companySettings.findUnique({ where: { id: "default" } })
  async function updateSettings(formData: FormData) {
    "use server"
    const data = {
      businessName: String(formData.get("businessName")),
      tradingName: String(formData.get("tradingName") || ""),
      email: String(formData.get("email") || ""),
      phone: String(formData.get("phone") || ""),
      addressLine1: String(formData.get("addressLine1") || ""),
      addressLine2: String(formData.get("addressLine2") || ""),
      city: String(formData.get("city") || ""),
      county: String(formData.get("county") || ""),
      postcode: String(formData.get("postcode") || ""),
      website: String(formData.get("website") || ""),
      companyNumber: String(formData.get("companyNumber") || ""),
      vatNumber: String(formData.get("vatNumber") || ""),
      invoicePrefix: String(formData.get("invoicePrefix") || "INV"),
      defaultPaymentTerms: Number(formData.get("defaultPaymentTerms") || 30),
      vatRegistered: formData.get("vatRegistered") === "on",
      defaultVatRate: Number(formData.get("defaultVatRate") || 20),
      emailFromName: String(formData.get("emailFromName") || ""),
      emailFromAddress: String(formData.get("emailFromAddress") || ""),
    }
    await prisma.companySettings.upsert({ where: { id: "default" }, update: data, create: { ...data, id: "default" } })
  }
  return <div className="space-y-6 max-w-3xl">
    <PageHeader title="Settings" description="Company profile, invoice defaults and tax settings" />
    <Link href="/settings/audit"><Button variant="secondary">View Audit Log</Button></Link>
    <form action={updateSettings} className="space-y-6">
      <div className="rounded-lg border bg-white p-6 space-y-4">
        <h2 className="text-lg font-semibold">Company Profile</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label><Input name="businessName" defaultValue={settings?.businessName || ""} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Trading Name</label><Input name="tradingName" defaultValue={settings?.tradingName || ""} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Email</label><Input name="email" type="email" defaultValue={settings?.email || ""} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone</label><Input name="phone" defaultValue={settings?.phone || ""} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Address Line 1</label><Input name="addressLine1" defaultValue={settings?.addressLine1 || ""} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Address Line 2</label><Input name="addressLine2" defaultValue={settings?.addressLine2 || ""} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">City</label><Input name="city" defaultValue={settings?.city || ""} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">County</label><Input name="county" defaultValue={settings?.county || ""} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Postcode</label><Input name="postcode" defaultValue={settings?.postcode || ""} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Website</label><Input name="website" defaultValue={settings?.website || ""} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Company Number</label><Input name="companyNumber" defaultValue={settings?.companyNumber || ""} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">VAT Number</label><Input name="vatNumber" defaultValue={settings?.vatNumber || ""} /></div>
        </div>
      </div>
      <div className="rounded-lg border bg-white p-6 space-y-4">
        <h2 className="text-lg font-semibold">Invoice Settings</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Invoice Prefix</label><Input name="invoicePrefix" defaultValue={settings?.invoicePrefix || "INV"} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Default Payment Terms (days)</label><Input name="defaultPaymentTerms" type="number" defaultValue={settings?.defaultPaymentTerms || 30} /></div>
        </div>
      </div>
      <div className="rounded-lg border bg-white p-6 space-y-4">
        <h2 className="text-lg font-semibold">Tax Settings</h2>
        <div className="flex items-center gap-2"><input type="checkbox" name="vatRegistered" id="vr" defaultChecked={settings?.vatRegistered} className="rounded border-gray-300" /><label htmlFor="vr" className="text-sm text-gray-700">VAT Registered</label></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Default VAT Rate %</label><Input name="defaultVatRate" type="number" defaultValue={settings?.defaultVatRate || 20} /></div>
      </div>
      <div className="rounded-lg border bg-white p-6 space-y-4">
        <h2 className="text-lg font-semibold">Email Settings</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">From Name</label><Input name="emailFromName" defaultValue={settings?.emailFromName || ""} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">From Email</label><Input name="emailFromAddress" type="email" defaultValue={settings?.emailFromAddress || ""} /></div>
        </div>
      </div>
      <Button type="submit">Save Settings</Button>
    </form>
  </div>
}
