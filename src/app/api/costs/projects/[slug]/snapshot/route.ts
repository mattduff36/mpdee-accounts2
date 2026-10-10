import { NextRequest, NextResponse } from 'next/server'
import { validProjectReadToken } from '@/lib/costs/project-read-auth'
import { projectSnapshot } from '@/lib/costs/project-snapshot'
import { loadProjectSnapshot } from '@/lib/costs/project-snapshot-load'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store' }
export async function GET(request: NextRequest, context: { params: { slug: string } }) {
  const slug = context.params.slug
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return NextResponse.json({ error: 'Invalid project' }, { status: 400, headers })
  const from = request.nextUrl.searchParams.get('from')
  if (from !== null && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(from) || !Number.isFinite(Date.parse(from)) || new Date(from).toISOString() !== from)) return NextResponse.json({ error: 'from must be an exact UTC ISO timestamp with milliseconds' }, { status: 400, headers })
  try {
    if (!validProjectReadToken(request.headers.get('authorization'), slug)) return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers })
  } catch { return NextResponse.json({ error: 'Project read access is not configured' }, { status: 503, headers }) }
  try {
    const asOf = new Date()
    const loaded = await loadProjectSnapshot(slug, { from, asOf })
    if (!loaded.ok) return NextResponse.json(loaded.limit ? { error: loaded.error, limit: loaded.limit } : { error: loaded.error }, { status: loaded.status, headers })
    return NextResponse.json(projectSnapshot(slug, loaded.rows, asOf, loaded.imports, from), { headers })
  } catch { return NextResponse.json({ error: 'Project snapshot unavailable' }, { status: 500, headers }) }
}
