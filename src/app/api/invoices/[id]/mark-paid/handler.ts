import { NextResponse } from "next/server"
import { requireApiWrite, WriteAccessError } from "@/lib/auth"
import { markInvoicePaid, MarkPaidError } from "@/lib/payments"

export type MarkPaidRouteDeps = {
  requireApiWrite: () => Promise<unknown>
  markInvoicePaid: typeof markInvoicePaid
}

export async function postMarkPaid(
  invoiceId: string,
  deps: MarkPaidRouteDeps = { requireApiWrite, markInvoicePaid }
) {
  try {
    await deps.requireApiWrite()
    const result = await deps.markInvoicePaid(invoiceId)
    return NextResponse.json({ success: true, ...result })
  } catch (error: unknown) {
    if (error instanceof WriteAccessError) {
      return NextResponse.json({ success: false, error: "Read-only access" }, { status: 403 })
    }
    if (error instanceof Error && error.message === "Authentication required") {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 })
    }
    if (error instanceof MarkPaidError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.httpStatus })
    }
    return NextResponse.json({ success: false, error: "Failed to mark invoice as paid" }, { status: 500 })
  }
}
