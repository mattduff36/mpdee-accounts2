import { NextResponse } from "next/server"
import { requireApiWrite, WriteAccessError } from "@/lib/auth"
import { sendInvoiceEmail } from "@/lib/email"

export type SendInvoiceRouteDeps = {
  requireApiWrite: () => Promise<unknown>
  sendInvoiceEmail: typeof sendInvoiceEmail
}

export async function postSendInvoice(
  invoiceId: string,
  deps: SendInvoiceRouteDeps = { requireApiWrite, sendInvoiceEmail }
) {
  try {
    await deps.requireApiWrite()
    const result = await deps.sendInvoiceEmail(invoiceId)
    if (result.ok) return NextResponse.json({ success: true })
    if (result.error === "Invoice not found") {
      return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 })
    }
    return NextResponse.json(
      { success: false, error: result.error || "Failed to send invoice email" },
      { status: 500 }
    )
  } catch (error: unknown) {
    if (error instanceof WriteAccessError) {
      return NextResponse.json({ success: false, error: "Read-only access" }, { status: 403 })
    }
    if (error instanceof Error && error.message === "Authentication required") {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 })
    }
    return NextResponse.json({ success: false, error: "Failed to send invoice" }, { status: 500 })
  }
}
