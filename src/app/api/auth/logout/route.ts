import { NextResponse } from "next/server"
import { cookies } from "next/headers"

const REQUEST_HOST = /^[a-z0-9.-]+(?::\d+)?$/i
const REQUEST_PROTO = /^https?$/

function redirectOrigin(request: Request): string {
  const url = new URL(request.url)
  const host = request.headers.get("host")?.trim() ?? ""
  if (!REQUEST_HOST.test(host)) return url.origin
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? ""
  const proto = REQUEST_PROTO.test(forwardedProto) ? forwardedProto : url.protocol.replace(":", "")
  return `${proto}://${host}`
}

export async function POST(request: Request) {
  const cookieStore = await cookies()
  cookieStore.set("session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  return NextResponse.redirect(new URL("/", redirectOrigin(request)), 303)
}
