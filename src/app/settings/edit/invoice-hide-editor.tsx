"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { confirmButtonLabel, type ConfirmPhase } from "@/lib/confirm-button-label"

const CONFIRM_MS = 2000

export type HideInvoiceRow = {
  id: string
  invoiceNumber: string
  clientName: string
  issued: string
  total: string
  viewHidden: boolean
}

export function InvoiceHideEditor({
  invoices,
  saveHidden,
  clearHidden,
}: {
  invoices: HideInvoiceRow[]
  saveHidden: (formData: FormData) => Promise<void>
  clearHidden: () => Promise<void>
}) {
  const [checked, setChecked] = useState(
    () => new Set(invoices.filter((invoice) => invoice.viewHidden).map((invoice) => invoice.id)),
  )
  const [pending, setPending] = useState<"save" | "clear" | null>(null)
  const pendingRef = useRef<"save" | "clear" | null>(null)
  const [savePhase, setSavePhase] = useState<ConfirmPhase>("idle")
  const [clearPhase, setClearPhase] = useState<ConfirmPhase>("idle")

  useEffect(() => {
    if (savePhase !== "success") return
    const timer = window.setTimeout(() => setSavePhase("idle"), CONFIRM_MS)
    return () => window.clearTimeout(timer)
  }, [savePhase])

  useEffect(() => {
    if (clearPhase !== "success") return
    const timer = window.setTimeout(() => setClearPhase("idle"), CONFIRM_MS)
    return () => window.clearTimeout(timer)
  }, [clearPhase])

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pendingRef.current) return
    const formData = new FormData(event.currentTarget)
    pendingRef.current = "save"
    setPending("save")
    setSavePhase("idle")
    try {
      await saveHidden(formData)
      setSavePhase("success")
    } catch {
      setSavePhase("error")
    } finally {
      pendingRef.current = null
      setPending(null)
    }
  }

  async function onClear() {
    if (pendingRef.current) return
    pendingRef.current = "clear"
    setPending("clear")
    setClearPhase("idle")
    try {
      await clearHidden()
      setChecked(new Set())
      setClearPhase("success")
    } catch {
      setClearPhase("error")
    } finally {
      pendingRef.current = null
      setPending(null)
    }
  }

  const saveLabel = confirmButtonLabel("Save", savePhase)
  const clearLabel = confirmButtonLabel("Clear", clearPhase)
  const busy = pending !== null

  return (
    <form onSubmit={onSave} className="space-y-6">
      <p className="sr-only" aria-live="polite">
        {savePhase === "idle" ? "" : saveLabel}
      </p>
      <p className="sr-only" aria-live="polite">
        {clearPhase === "idle" ? "" : clearLabel}
      </p>
      <PageHeader
        title="Edit"
        description="Tick invoices to hide them from the rest of the app. Hidden invoices stay hidden until you clear them."
      >
        <Button
          type="button"
          variant="secondary"
          onClick={onClear}
          disabled={busy}
          className="min-w-[5.75rem]"
        >
          {clearLabel}
        </Button>
        <Button type="submit" disabled={busy} className="min-w-[5.75rem]">
          {saveLabel}
        </Button>
      </PageHeader>
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
                      checked={checked.has(invoice.id)}
                      disabled={busy}
                      aria-label={`Hide ${invoice.invoiceNumber}`}
                      onChange={(event) => {
                        const on = event.target.checked
                        setChecked((current) => {
                          const next = new Set(current)
                          if (on) next.add(invoice.id)
                          else next.delete(invoice.id)
                          return next
                        })
                      }}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium">{invoice.invoiceNumber}</td>
                  <td className="px-4 py-3 text-gray-500">{invoice.clientName}</td>
                  <td className="px-4 py-3 text-gray-500">{invoice.issued}</td>
                  <td className="px-4 py-3 text-right font-medium">{invoice.total}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Button type="submit" disabled={busy} className="min-w-[5.75rem]">
        {saveLabel}
      </Button>
    </form>
  )
}
