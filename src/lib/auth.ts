import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { createHmac, timingSafeEqual } from "crypto"
import { prisma } from "./db"
import bcrypt from "bcryptjs"

const SESSION_COOKIE = "session"
const SESSION_MAX_AGE = 60 * 60 * 24 * 7

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set (min 32 characters)")
  }
  return secret
}

function signSession(userId: string, token: string): string {
  const payload = `${token}:${userId}`
  const sig = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url")
  return `${payload}:${sig}`
}

function verifySessionValue(value: string): { userId: string } | null {
  const parts = value.split(":")
  if (parts.length !== 3) return null
  const [token, userId, sig] = parts
  if (!token || !userId || !sig) return null
  const payload = `${token}:${userId}`
  const expected = createHmac("sha256", getSessionSecret()).update(payload).digest("base64url")
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  return { userId }
}

export async function createSession(userId: string): Promise<void> {
  const cookieStore = await cookies()
  const token = crypto.randomUUID()
  cookieStore.set(SESSION_COOKIE, signSession(userId, token), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  })
}

export async function getSessionUser(): Promise<{
  id: string
  email: string
  name: string | null
  role: string
} | null> {
  const cookieStore = await cookies()
  const session = cookieStore.get(SESSION_COOKIE)
  if (!session?.value) return null
  const verified = verifySessionValue(session.value)
  if (!verified) return null
  return prisma.user.findUnique({
    where: { id: verified.userId, isActive: true },
    select: { id: true, email: true, name: true, role: true },
  })
}

export async function requireAuth() {
  const user = await getSessionUser()
  if (!user) redirect("/login")
  return user
}

export async function requireApiAuth() {
  const user = await getSessionUser()
  if (!user) throw new Error("Authentication required")
  return user
}

export async function logout() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
  redirect("/login")
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12)
}
