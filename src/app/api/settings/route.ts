import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
export async function GET() {
  const settings = await prisma.companySettings.findUnique({ where: { id: "default" } })
  return NextResponse.json(settings || {})
}
