import { NextRequest, NextResponse } from 'next/server'
import { validProjectReadToken } from '@/lib/costs/project-read-auth'
import { loadProjectBilling, type ProjectBillingLoad } from '@/lib/costs/project-billing-load'

const headers = { 'Cache-Control': 'private, no-store' }
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export async function getProjectBilling(
  request: NextRequest,
  context: { params: { slug: string } },
  deps: { load?: (slug: string) => Promise<ProjectBillingLoad>; authorize?: (authorization: string | null, slug: string) => boolean } = {},
) {
  const slug = context.params.slug
  if (!slugPattern.test(slug)) return NextResponse.json({ error: 'Invalid project' }, { status: 400, headers })
  try {
    const authorize = deps.authorize ?? validProjectReadToken
    if (!authorize(request.headers.get('authorization'), slug)) return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers })
  } catch {
    return NextResponse.json({ error: 'Project read access is not configured' }, { status: 503, headers })
  }
  try {
    const result = await (deps.load ?? loadProjectBilling)(slug)
    return NextResponse.json(result.body, { status: result.status, headers })
  } catch {
    return NextResponse.json({ error: 'Project billing unavailable' }, { status: 500, headers })
  }
}
