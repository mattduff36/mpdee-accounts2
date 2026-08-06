import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const publicPaths = ["/login", "/api/auth/login", "/api/auth/logout"]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (publicPaths.some((p) => pathname.startsWith(p))) return NextResponse.next()
  // Block public seed endpoint entirely
  if (pathname.startsWith("/api/seed")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const session = request.cookies.get("session")
  if (!session?.value) return NextResponse.redirect(new URL("/login", request.url))
  return NextResponse.next()
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"] }
