import { NextRequest, NextResponse } from 'next/server'
import { LEDGER_START } from '@/lib/costs/comparison-policy'
import { loadProjectComparison } from '@/lib/costs/comparison-load'
import { projectCostSummary } from '@/lib/costs/project-summary'
import { validProjectReadToken } from '@/lib/costs/project-read-auth'
import { loadProjectComparisonEstimate } from '@/lib/costs/provisional-load'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: NextRequest, context: { params: { slug: string } }) {
  const slug = context.params.slug
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return NextResponse.json({ error: 'Invalid project' }, { status: 400, headers })
  try {
    if (!validProjectReadToken(request.headers.get('authorization'), slug)) return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers })
  } catch {
    return NextResponse.json({ error: 'Project read access is not configured' }, { status: 503, headers })
  }
  try {
    const loaded = await loadProjectComparisonEstimate(slug)
    if (!loaded) return NextResponse.json({ error: 'Project not found' }, { status: 404, headers })
    const compared = await loadProjectComparison(slug, LEDGER_START, null)
    return NextResponse.json(projectCostSummary({
      project: slug,
      estimate: loaded.estimate,
      comparisonRevision: compared.comparison.revision,
      outstanding: compared.comparison.outstanding,
    }), { headers })
  } catch (error) {
    if (error instanceof Error && error.message === 'Project not found') return NextResponse.json({ error: 'Project not found' }, { status: 404, headers })
    return NextResponse.json({ error: 'Project summary unavailable' }, { status: 500, headers })
  }
}
