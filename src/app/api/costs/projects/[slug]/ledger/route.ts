import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ledger } from '@/lib/costs/service'
import { validProjectReadToken } from '@/lib/costs/project-read-auth'
import { projectLedgerResponse } from '@/lib/costs/project-ledger-response'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const headers = { 'Cache-Control': 'private, no-store' }
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export async function GET(request: NextRequest, context: { params: { slug: string } }) {
  const slug = context.params.slug
  if (!slugPattern.test(slug)) return NextResponse.json({ error: 'Invalid project' }, { status: 400, headers })
  const month = request.nextUrl.searchParams.get('month') ?? new Date().toISOString().slice(0, 7)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: 'Month must use YYYY-MM format' }, { status: 400, headers })
  try {
    if (!validProjectReadToken(request.headers.get('authorization'), slug)) return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers })
  } catch {
    return NextResponse.json({ error: 'Project read access is not configured' }, { status: 503, headers })
  }
  try {
    const project = await prisma.costProject.findUnique({ where: { slug }, select: { id: true, slug: true } })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404, headers })
    const data = await ledger(month, project.id)
    return NextResponse.json(projectLedgerResponse(data.month, project.slug, data.rows), { headers })
  } catch {
    return NextResponse.json({ error: 'Project ledger unavailable' }, { status: 500, headers })
  }
}
