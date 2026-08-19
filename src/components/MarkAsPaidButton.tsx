"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CircleCheck } from "lucide-react"
import { ConfirmModal } from "./ConfirmModal"
import { IconAction } from "./IconAction"

export function MarkAsPaidButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function onConfirm() {
    setOpen(false)
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/mark-paid`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "Failed to mark as paid")
        setLoading(false)
        return
      }
      router.refresh()
    } catch {
      setError("Failed to mark as paid")
    }
    setLoading(false)
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <IconAction
        title="Mark as Paid"
        icon={CircleCheck}
        tone="green"
        loading={loading}
        disabled={loading}
        onClick={() => setOpen(true)}
      />
      {error && <span className="text-xs text-red-600">{error}</span>}
      <ConfirmModal
        open={open}
        title="Mark as Paid"
        message="Mark this invoice as paid?"
        confirmLabel="Mark as Paid"
        confirmVariant="primary"
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    </span>
  )
}
