"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export function SendInvoiceButton({
  invoiceId,
  label = "Send",
  variant = "primary",
  size = "sm",
}: {
  invoiceId: string
  label?: string
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline"
  size?: "sm" | "md" | "lg"
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSend() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/send`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "Failed to send")
        setLoading(false)
        return
      }
      router.refresh()
    } catch {
      setError("Failed to send")
    }
    setLoading(false)
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button type="button" variant={variant} size={size} disabled={loading} onClick={handleSend}>
        {loading ? "Sending..." : label}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}
