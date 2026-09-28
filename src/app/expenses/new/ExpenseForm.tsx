"use client"

import { useFormState, useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EXPENSE_PAYMENT_METHODS } from "@/lib/constants"
import type { ExpenseFormActionState } from "@/lib/expense-form"
import Link from "next/link"

type Option = { id: string; name: string }
type Props = {
  action: (state: ExpenseFormActionState, formData: FormData) => Promise<ExpenseFormActionState>
  categories: Option[]
  clients: Option[]
}

const initialState: ExpenseFormActionState = { errors: {}, values: {} }

function SaveExpenseButton() {
  const { pending } = useFormStatus()
  return <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save expense"}</Button>
}

export function ExpenseForm({ action, categories, clients }: Props) {
  const [state, formAction] = useFormState(action, initialState)
  const error = (field: string) => state.errors[field]
  const invalid = (field: string) => error(field) ? { "aria-invalid": true as const, "aria-describedby": `${field}-error` } : {}
  const fieldError = (field: string) => error(field) ? <p id={`${field}-error`} className="mt-1 text-sm text-rose-700">{error(field)}</p> : null
  return <form action={formAction} className="space-y-4 rounded-lg border bg-white p-6">
    {Object.keys(state.errors).length > 0 && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">The expense was not saved. Correct the highlighted field and try again.</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      <div><label htmlFor="categoryId" className="block text-sm font-medium text-gray-700 mb-1">Category *</label><select id="categoryId" name="categoryId" required defaultValue={state.values.categoryId ?? categories[0]?.id ?? ""} className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" {...invalid("categoryId")}><option value="" disabled>Choose a category</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{fieldError("categoryId")}</div>
      <div><label htmlFor="date" className="block text-sm font-medium text-gray-700 mb-1">Date *</label><Input id="date" name="date" type="date" required defaultValue={state.values.date ?? new Date().toISOString().split("T")[0]} {...invalid("date")} />{fieldError("date")}</div>
      <div><label htmlFor="supplier" className="block text-sm font-medium text-gray-700 mb-1">Supplier</label><Input id="supplier" name="supplier" defaultValue={state.values.supplier ?? ""} {...invalid("supplier")} />{fieldError("supplier")}</div>
      <div><label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">Description *</label><Input id="description" name="description" required defaultValue={state.values.description ?? ""} {...invalid("description")} />{fieldError("description")}</div>
      <div><label htmlFor="netAmount" className="block text-sm font-medium text-gray-700 mb-1">Net Amount *</label><Input id="netAmount" name="netAmount" type="number" step="0.01" inputMode="decimal" placeholder="0.00" required defaultValue={state.values.netAmount ?? ""} {...invalid("netAmount")} />{fieldError("netAmount")}</div>
      <div><label htmlFor="vatRate" className="block text-sm font-medium text-gray-700 mb-1">VAT Rate</label><select id="vatRate" name="vatRate" defaultValue={state.values.vatRate ?? "20"} className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" {...invalid("vatRate")}><option value="20">20%</option><option value="5">5%</option><option value="0">0%</option></select>{fieldError("vatRate")}</div>
      <div><label htmlFor="paymentMethod" className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label><select id="paymentMethod" name="paymentMethod" defaultValue={state.values.paymentMethod ?? EXPENSE_PAYMENT_METHODS[0]} className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" {...invalid("paymentMethod")}>{EXPENSE_PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}</select>{fieldError("paymentMethod")}</div>
      <div><label htmlFor="reference" className="block text-sm font-medium text-gray-700 mb-1">Reference</label><Input id="reference" name="reference" defaultValue={state.values.reference ?? ""} {...invalid("reference")} />{fieldError("reference")}</div>
      <div><label htmlFor="clientId" className="block text-sm font-medium text-gray-700 mb-1">Client (if billable)</label><select id="clientId" name="clientId" defaultValue={state.values.clientId ?? ""} className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" {...invalid("clientId")}><option value="">None</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{fieldError("clientId")}</div>
    </div>
    <div className="flex flex-wrap gap-4">
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="isReimbursable" className="rounded border-gray-300" defaultChecked={state.values.isReimbursable === "on"} />Reimbursable</label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="isBillable" className="rounded border-gray-300" defaultChecked={state.values.isBillable === "on"} />Billable</label>
    </div>
    <div><label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">Notes</label><textarea id="notes" name="notes" rows={2} defaultValue={state.values.notes ?? ""} {...invalid("notes")} className="flex min-h-[60px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" />{fieldError("notes")}</div>
    <div className="flex flex-wrap gap-2"><SaveExpenseButton /><Link className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500" href="/expenses">Cancel</Link></div>
  </form>
}
