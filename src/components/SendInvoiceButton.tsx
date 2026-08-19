"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Send } from "lucide-react"
import { IconAction } from "./IconAction"

export function SendInvoiceButton({
  invoiceId,
  mode = "send",
}: {
  invoiceId: string
  mode?: "send" | "resend"
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
      <IconAction
        title={mode === "resend" ? "Resend Invoice" : "Send Invoice"}
        icon={Send}
        tone={mode === "resend" ? "blue" : "green"}
        loading={loading}
        disabled={loading}
        onClick={handleSend}
      />
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}
