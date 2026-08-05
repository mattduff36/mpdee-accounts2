import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from './db'
import bcrypt from 'bcryptjs'
const SESSION_COOKIE = 'session'
const SESSION_MAX_AGE = 60 * 60 * 24 * 7
export async function createSession(userId: string): Promise<void> {
  const cookieStore = await cookies()
  const token = crypto.randomUUID()
  cookieStore.set(SESSION_COOKIE, `${token}:${userId}`, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: SESSION_MAX_AGE, path: '/' })
}
export async function getSessionUser(): Promise<{ id: string; email: string; name: string | null; role: string } | null> {
  const cookieStore = await cookies()
  const session = cookieStore.get(SESSION_COOKIE)
  if (!session?.value) return null
  const parts = session.value.split(':')
  if (parts.length < 2) return null
  const userId = parts[parts.length - 1]
  const user = await prisma.user.findUnique({ where: { id: userId, isActive: true }, select: { id: true, email: true, name: true, role: true } })
  return user
}
export async function requireAuth() { const user = await getSessionUser(); if (!user) redirect('/login'); return user }
export async function logout() { const cookieStore = await cookies(); cookieStore.delete(SESSION_COOKIE); redirect('/login') }
export async function verifyPassword(plain: string, hash: string): Promise<boolean> { return bcrypt.compare(plain, hash) }
export async function hashPassword(plain: string): Promise<string> { return bcrypt.hash(plain, 12) }
