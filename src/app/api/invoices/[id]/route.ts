import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireApiAuth } from "@/lib/auth"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireApiAuth()
    const { id } = await params
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { client: true, items: true, payments: true },
    })
    if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(invoice)
  } catch (error: any) {
    if (error.message === "Authentication required") {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
