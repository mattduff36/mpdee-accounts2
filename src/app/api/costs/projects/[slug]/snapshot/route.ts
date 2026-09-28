import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validProjectReadToken } from '@/lib/costs/project-read-auth'
import { resolvePolicy } from '@/lib/costs/service'
import { ledgerFx } from '@/lib/costs/fx'
import { projectSnapshot } from '@/lib/costs/project-snapshot'
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
    const project = await prisma.costProject.findUnique({ where: { slug } })
    if (!project || project.archived) return NextResponse.json({ error: 'Project not found' }, { status: 404, headers })
    const [events, policies] = await Promise.all([
      prisma.costUsageEvent.findMany({ where: { projectId: project.id, ...(from ? { occurredAt: { gte: new Date(from) } } : {}) }, include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } }, orderBy: { id: 'asc' }, take: 50001 }),
      prisma.costPolicy.findMany({ where: { OR: [{ projectId: project.id }, ...(project.clientId ? [{ projectId: null, clientId: project.clientId }] : [])] } }),
    ])
    if (events.length > 50000) return NextResponse.json({ error: 'Complete project history exceeds snapshot limit', limit: 50000 }, { status: 422, headers })
    const rows = events.map(event => {
      const revision = event.revisions[0], policy = resolvePolicy(policies, project.id, project.clientId, event.occurredAt)
      const hold = !revision ? 'Missing revision' : revision.quality !== 'complete' ? 'Source requires review' : !policy ? 'No effective charging policy' : null
      return { event, revision, policy, hold }
    })
    const accounts = Array.from(new Map(events.map(e => [e.provider + ':' + e.accountRef, { provider: e.provider, accountRef: e.accountRef }])).values())
    const [fx, latestImport] = await Promise.all([
      ledgerFx(rows),
      accounts.length ? prisma.costImportRun.findFirst({ where: { OR: accounts }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }) : Promise.resolve(null),
    ])
    return NextResponse.json(projectSnapshot(slug, rows.map((row, i) => ({ ...row, fx: fx.quotes[i] })), new Date(), latestImport ? [latestImport.createdAt] : [], from), { headers })
  } catch { return NextResponse.json({ error: 'Project snapshot unavailable' }, { status: 500, headers }) }
}
