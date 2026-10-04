import { NextRequest, NextResponse } from 'next/server'
import { validProjectReadToken } from '@/lib/costs/project-read-auth'
import { LEDGER_START } from '@/lib/costs/comparison-policy'
import { loadProjectComparison } from '@/lib/costs/comparison-load'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store' }
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export async function GET(request: NextRequest, context: { params: { slug: string } }) {
  const slug = context.params.slug
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return NextResponse.json({ error: 'Invalid project' }, { status: 400, headers })
  const from = request.nextUrl.searchParams.get('from') ?? LEDGER_START
  if (!iso.test(from) || new Date(from).toISOString() !== from || from < LEDGER_START) return NextResponse.json({ error: 'from must be an exact UTC timestamp on or after the ledger start' }, { status: 400, headers })
  const subscriptionText = request.nextUrl.searchParams.get('subscriptionPence')
  if (subscriptionText !== null && !/^-?\d+$/.test(subscriptionText)) return NextResponse.json({ error: 'subscriptionPence must be integer pence' }, { status: 400, headers })
  try {
    if (!validProjectReadToken(request.headers.get('authorization'), slug)) return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers })
  } catch { return NextResponse.json({ error: 'Project read access is not configured' }, { status: 503, headers }) }
  try {
    const loaded = await loadProjectComparison(slug, from, subscriptionText)
    return NextResponse.json(loaded.comparison, { headers })
  } catch (error) {
    const message = error instanceof Error && error.message.includes('not found') ? 'Project not found' : error instanceof Error && error.message.includes('limit') ? error.message : 'Project comparison unavailable'
    const status = message === 'Project not found' ? 404 : message.includes('limit') ? 422 : 500
    return NextResponse.json({ error: message }, { status, headers })
  }
}
