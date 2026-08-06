import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { verifyPassword, createSession } from "@/lib/auth"

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json()
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 })
    }
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !(await verifyPassword(password, user.password))) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
    }
    if (!user.isActive) {
      return NextResponse.json({ error: "Account deactivated" }, { status: 403 })
    }
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await createSession(user.id)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
