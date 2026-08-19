import { NextResponse } from "next/server"
import { requireApiAuth } from "@/lib/auth"
import { markInvoicePaid, MarkPaidError } from "@/lib/payments"

export type MarkPaidRouteDeps = {
  requireApiAuth: () => Promise<unknown>
  markInvoicePaid: typeof markInvoicePaid
}

export async function postMarkPaid(
  invoiceId: string,
  deps: MarkPaidRouteDeps = { requireApiAuth, markInvoicePaid }
) {
  try {
    await deps.requireApiAuth()
    const result = await deps.markInvoicePaid(invoiceId)
    return NextResponse.json({ success: true, ...result })
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Authentication required") {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 })
    }
    if (error instanceof MarkPaidError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.httpStatus })
    }
    const message = error instanceof Error ? error.message : "Failed to mark invoice as paid"
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
