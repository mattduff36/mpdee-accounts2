import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireApiAuth } from "@/lib/auth"

export async function GET() {
  try {
    await requireApiAuth()
    const settings = await prisma.companySettings.findUnique({ where: { id: "default" } })
    return NextResponse.json(settings || {})
  } catch (error: any) {
    if (error.message === "Authentication required") {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
