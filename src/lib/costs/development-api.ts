import { NextRequest, NextResponse } from 'next/server'
import { validIngestToken } from './machine-auth'
import { type loadDevelopmentReport } from './development-load'
import { DevelopmentReportError, parseDevelopmentQuery } from './development-report'

const headers = { 'Cache-Control': 'private, no-store' }
export async function developmentResponse(request: NextRequest, deps: {
  token: string | undefined
  sessionUser: () => Promise<{ role: string } | null>
  load: typeof loadDevelopmentReport
}) {
  try {
    const machine = validIngestToken(request.headers.get('authorization'), deps.token)
    if (!machine && !await deps.sessionUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers })
    const params = request.nextUrl.searchParams
    if ([...params.keys()].some(key => params.getAll(key).length > 1)) throw new DevelopmentReportError('Repeated query parameters are not supported')
    const query = parseDevelopmentQuery(Object.fromEntries(params))
    return NextResponse.json(await deps.load(query), { headers })
  } catch (error) {
    if (error instanceof DevelopmentReportError) return NextResponse.json({ error: error.message }, { status: error.status, headers })
    console.error('Development report unavailable')
    return NextResponse.json({ error: 'Development report unavailable' }, { status: 500, headers })
  }
}
