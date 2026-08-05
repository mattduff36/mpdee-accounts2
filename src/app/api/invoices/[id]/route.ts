import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { client: true, items: true, payments: true } })
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(invoice)
}
