import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { ledger } from '@/lib/costs/service'
import { unitsText } from '@/lib/costs/money'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  try { await requireApiAuth() } catch { return NextResponse.json({ error: 'Authentication required' }, { status: 401 }) }
  const data = await ledger(request.nextUrl.searchParams.get('month') ?? undefined,request.nextUrl.searchParams.get('project') || undefined)
  const contents = { version: 'mpdee-ledger-export-v1', generatedAt: new Date().toISOString(), month: data.month, mode: 'preview-estimates', rows: data.rows.map(r => ({
    id: r.event.id, sourceKey: r.event.sourceKey, provider: r.event.provider, accountRef: r.event.accountRef, occurredAt: r.event.occurredAt,
    project: r.event.project?.slug ?? null, clientId: r.event.project?.clientId ?? null, attribution: r.event.attribution,
    funding: r.revision?.funding, nominal: r.revision?.nominalUnits == null ? null : unitsText(r.revision.nominalUnits),
    providerCost: r.revision?.providerUnits == null ? null : unitsText(r.revision.providerUnits),
    chargeEstimate: r.charge === null ? null : unitsText(r.charge), currency: r.revision?.currency,
    fxGbp: r.revision?.fxGbp?.toString() ?? null, revision: r.revision?.revision, policyId: r.policy?.id ?? null,
    hold: r.hold, quality: r.revision?.quality,
  })) }
  return new NextResponse(JSON.stringify(contents,null,2), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="project-costs-${data.month}.json"`, 'Cache-Control': 'private, no-store' } })
}
