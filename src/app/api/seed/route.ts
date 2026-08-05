import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { hashPassword } from "@/lib/auth"
import { EXPENSE_CATEGORIES } from "@/lib/constants"
export async function POST() {
  try {
    const existingUser = await prisma.user.findUnique({ where: { email: "admin@example.com" } })
    if (!existingUser) { await prisma.user.create({ data: { email: "admin@example.com", name: "Admin User", password: await hashPassword("changeme123"), role: "admin" } }) }
    const existingSettings = await prisma.companySettings.findUnique({ where: { id: "default" } })
    if (!existingSettings) { await prisma.companySettings.create({ data: { id: "default", businessName: "My Business" } }) }
    for (const cat of EXPENSE_CATEGORIES) { const existing = await prisma.expenseCategory.findUnique({ where: { name: cat.name } }); if (!existing) await prisma.expenseCategory.create({ data: { name: cat.name, color: cat.color } }) }
    return NextResponse.json({ success: true, message: "Database seeded" })
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
