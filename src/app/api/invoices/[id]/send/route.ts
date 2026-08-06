import { NextRequest, NextResponse } from "next/server"
import { requireApiAuth } from "@/lib/auth"
import { sendInvoiceEmail } from "@/lib/email"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiAuth()
    const { id } = await params
    const result = await sendInvoiceEmail(id)
    if (result.ok) return NextResponse.json({ success: true })
    return NextResponse.json(
      { success: false, error: result.error || "Failed to send invoice email" },
      { status: 500 }
    )
  } catch (error: any) {
    if (error.message === "Authentication required") {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 })
    }
    return NextResponse.json(
      { success: false, error: error.message || "Failed to send invoice" },
      { status: 500 }
    )
  }
}
