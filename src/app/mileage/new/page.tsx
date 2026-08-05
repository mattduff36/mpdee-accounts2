import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default async function NewMileagePage() {
  async function createMileage(formData: FormData) {
    "use server"
    const miles = parseFloat(String(formData.get("miles")))
    const ratePerMile = parseFloat(String(formData.get("ratePerMile") || "0.45"))
    const amount = Math.round(miles * ratePerMile)
    await prisma.mileageExpense.create({ data: {
      date: new Date(String(formData.get("date"))),
      description: String(formData.get("description")),
      startLocation: String(formData.get("startLocation") || ""),
      endLocation: String(formData.get("endLocation") || ""),
      miles, ratePerMile, amount,
      vehicleReg: String(formData.get("vehicleReg") || ""),
      isReimbursable: formData.get("isReimbursable") === "on",
      isBillable: formData.get("isBillable") === "on",
      notes: String(formData.get("notes") || ""),
    }})
    redirect("/mileage")
  }
  return <div className="space-y-6 max-w-2xl">
    <PageHeader title="Log Mileage" />
    <form action={createMileage} className="space-y-4 rounded-lg border bg-white p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Date *</label><Input name="date" type="date" required defaultValue={new Date().toISOString().split("T")[0]} /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Miles *</label><Input name="miles" type="number" step="0.1" required /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Description *</label><Input name="description" required /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Rate per Mile (£)</label><Input name="ratePerMile" type="number" step="0.01" defaultValue="0.45" /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Start Location</label><Input name="startLocation" /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">End Location</label><Input name="endLocation" /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Reg</label><Input name="vehicleReg" /></div>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isReimbursable" className="rounded border-gray-300" />Reimbursable</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isBillable" className="rounded border-gray-300" />Billable</label>
      </div>
      <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes</label><textarea name="notes" rows={2} className="flex min-h-[60px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" /></div>
      <div className="flex gap-2"><Button type="submit">Save</Button><a href="/mileage"><Button type="button" variant="secondary">Cancel</Button></a></div>
    </form>
  </div>
}
