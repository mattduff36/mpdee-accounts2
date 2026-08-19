"use client"

import { Upload } from "lucide-react"
import { useRef, useState, type ChangeEvent } from "react"
import {
  InvoiceLineItems,
  blankInvoiceLineItem,
  type InvoiceLineItemDraft,
} from "@/components/InvoiceLineItems"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { parseInvoiceImportJson } from "@/lib/import-invoice-json"

type ClientOption = {
  id: string
  name: string
}

export function NewInvoiceForm({
  clients,
  defaultPaymentTerms,
  defaultIssueDate,
  action,
}: {
  clients: ClientOption[]
  defaultPaymentTerms: number
  defaultIssueDate: string
  action: (formData: FormData) => void | Promise<void>
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nextId = useRef(1)
  const [clientId, setClientId] = useState(clients[0]?.id ?? "")
  const [paymentTerms, setPaymentTerms] = useState(String(defaultPaymentTerms))
  const [issueDate, setIssueDate] = useState(defaultIssueDate)
  const [dueDate, setDueDate] = useState("")
  const [notes, setNotes] = useState("")
  const [internalNotes, setInternalNotes] = useState("")
  const [items, setItems] = useState<InvoiceLineItemDraft[]>([blankInvoiceLineItem(0)])
  const [showAgency, setShowAgency] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importNotice, setImportNotice] = useState<string | null>(null)

  function addItem() {
    const id = nextId.current
    nextId.current += 1
    setItems((current) => [...current, blankInvoiceLineItem(id)])
  }

  function removeItem(id: number) {
    setItems((current) => (current.length <= 1 ? current : current.filter((item) => item.id !== id)))
  }

  function changeItem(id: number, patch: Partial<InvoiceLineItemDraft>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function formHasContent() {
    return (
      items.some((item) => item.description.trim() || item.unitPrice.trim()) ||
      notes.trim() !== "" ||
      internalNotes.trim() !== ""
    )
  }

  async function importFile(file: File) {
    try {
      const draft = parseInvoiceImportJson(await file.text(), {
        paymentTerms: Number(paymentTerms) || defaultPaymentTerms,
      })
      if (formHasContent() && !window.confirm("Replace the current invoice details with the imported file?")) {
        return
      }
      setItems(
        draft.items.map((item, index) => ({
          id: index,
          ...item,
        })),
      )
      nextId.current = draft.items.length
      if (draft.issueDate) setIssueDate(draft.issueDate)
      if (draft.dueDate) setDueDate(draft.dueDate)
      setNotes(draft.notes)
      setInternalNotes(draft.internalNotes)
      setImportError(null)
      setImportNotice(`Imported ${draft.items.length} line item${draft.items.length === 1 ? "" : "s"}.`)
    } catch (error) {
      setImportNotice(null)
      setImportError(error instanceof Error ? error.message : "Could not import that file.")
    }
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (file) await importFile(file)
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader title="New Invoice">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={onFileChange}
        />
        <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>
          <Upload className="mr-1.5 h-4 w-4" />
          Import
        </Button>
      </PageHeader>
      {importError && (
        <p className="text-sm text-rose-600" role="alert">
          {importError}
        </p>
      )}
      {importNotice && !importError && <p className="text-sm text-slate-600">{importNotice}</p>}
      <form action={action} className="space-y-6 rounded-lg border bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client *</label>
            <select
              name="clientId"
              required
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms (days)</label>
            <Input
              name="paymentTerms"
              type="number"
              value={paymentTerms}
              onChange={(event) => setPaymentTerms(event.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Issue Date *</label>
            <Input
              name="issueDate"
              type="date"
              required
              value={issueDate}
              onChange={(event) => setIssueDate(event.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Due Date *</label>
            <Input name="dueDate" type="date" required value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </div>
        </div>
        <InvoiceLineItems
          items={items}
          showAgency={showAgency}
          onShowAgencyChange={setShowAgency}
          onAddItem={addItem}
          onRemoveItem={removeItem}
          onChangeItem={changeItem}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (client-visible)</label>
            <textarea
              name="notes"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Internal Notes</label>
            <textarea
              name="internalNotes"
              rows={3}
              value={internalNotes}
              onChange={(event) => setInternalNotes(event.target.value)}
              className="flex min-h-[80px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit">Save as Draft</Button>
          <a href="/invoices">
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </a>
        </div>
      </form>
    </div>
  )
}
