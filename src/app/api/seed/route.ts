import { NextResponse } from "next/server"

/** Public seeding is disabled. Use `npm run db:seed` locally instead. */
export async function POST() {
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}

export async function GET() {
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}
