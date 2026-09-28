import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validProjectReadToken } from '@/lib/costs/project-read-auth'
import { legacyBaseline } from '@/lib/costs/legacy-baseline'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store' }

// Complete, read-only baseline. No mutation/correction or incremental filters.
export async function GET(request: NextRequest, context: { params: { slug: string } }) {
  const slug = context.params.slug
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return NextResponse.json({ error: 'Invalid project' }, { status: 400, headers })
  if (request.nextUrl.search) return NextResponse.json({ error: 'Legacy baseline does not support filters' }, { status: 400, headers })
  try {
    if (!validProjectReadToken(request.headers.get('authorization'), slug)) return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers })
  } catch { return NextResponse.json({ error: 'Project read access is not configured' }, { status: 503, headers }) }
  try {
    const project = await prisma.costProject.findUnique({ where: { slug }, select: { id: true, archived: true } })
    if (!project || project.archived) return NextResponse.json({ error: 'Project not found' }, { status: 404, headers })
    const rows = await prisma.costLegacyCharge.findMany({ where: { projectId: project.id }, orderBy: { id: 'asc' }, take: 50001, select: { id: true, projectId: true, sourceRevision: true, sourceChecksum: true, category: true, periodStart: true, periodEnd: true, label: true, frozenGbpPence: true, invoiceability: true } })
    if (rows.length > 50000) return NextResponse.json({ error: 'Complete legacy baseline exceeds limit', limit: 50000 }, { status: 422, headers })
    return NextResponse.json(legacyBaseline(slug, project.id, rows), { headers })
  } catch { return NextResponse.json({ error: 'Legacy baseline unavailable' }, { status: 500, headers }) }
}
