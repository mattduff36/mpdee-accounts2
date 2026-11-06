import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { requireApiAuth, requireApiWrite, WriteAccessError } from '@/lib/auth'
import { validIngestToken } from '@/lib/costs/machine-auth'
import { ManualAllocationError, manualAllocationQuerySchema } from '@/lib/costs/manual-allocation'
import { listManualAllocationReport, persistManualAllocation } from '@/lib/costs/manual-allocation-store'

export type ManualAllocationDeps = {
  requireApiAuth: () => Promise<unknown>
  requireApiWrite: () => Promise<{ id: string }>
  isReadToken: (header: string | null) => boolean
  list: typeof listManualAllocationReport
  save: typeof persistManualAllocation
}
const dependencies: ManualAllocationDeps = {
  requireApiAuth, requireApiWrite,
  isReadToken: header => validIngestToken(header, process.env.COSTS_INGEST_TOKEN),
  list: listManualAllocationReport, save: persistManualAllocation,
}
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' } })
}
async function readBody(request: NextRequest): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new ManualAllocationError(400, 'Missing JSON body')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.length
      if (length > 16384) {
        await reader.cancel()
        throw new RangeError('Body too large')
      }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new ManualAllocationError(400, 'Invalid JSON body') }
}
export async function handleManualAllocations(request: NextRequest, method: 'GET' | 'POST', deps = dependencies) {
  try {
    if (method === 'GET') {
      if (!deps.isReadToken(request.headers.get('authorization'))) await deps.requireApiAuth()
      const params = request.nextUrl.searchParams
      if (new Set(params.keys()).size !== Array.from(params.keys()).length) throw new ManualAllocationError(400, 'Duplicate query parameters')
      return json(await deps.list(manualAllocationQuerySchema.parse(Object.fromEntries(params))))
    }
    // Tokens are read-only here, even though source import APIs permit machine creates.
    const user = await deps.requireApiWrite()
    if (request.headers.get('origin') !== request.nextUrl.origin) return json({ error: 'Invalid origin' }, 403)
    return json(await deps.save(await readBody(request), user.id))
  } catch (error) {
    if (error instanceof WriteAccessError) return json({ error: 'Write access required' }, 403)
    if (error instanceof Error && error.message === 'Authentication required') return json({ error: 'Authentication required' }, 401)
    if (error instanceof ManualAllocationError) return json({ error: error.message }, error.status)
    if (error instanceof ZodError) return json({ error: 'Invalid allocation fields or query', issues: error.issues.map(issue => ({ path: issue.path, message: issue.message })) }, 400)
    if (error instanceof RangeError && error.message === 'Body too large') return json({ error: 'Record exceeds 16384 bytes' }, 413)
    console.error('Manual cost allocation request failed; no partial write committed')
    return json({ error: 'Allocation request failed; try again' }, 500)
  }
}
