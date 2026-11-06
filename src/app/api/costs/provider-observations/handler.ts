import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { requireApiAuth, requireApiWrite, WriteAccessError } from '@/lib/auth'
import { validIngestToken } from '@/lib/costs/machine-auth'
import { providerObservationQuerySchema, ProviderObservationError } from '@/lib/costs/provider-observations'
import { listProviderObservations, saveProviderObservation } from '@/lib/costs/provider-observations-store'

export type ProviderObservationDeps = {
  requireApiAuth: () => Promise<unknown>
  requireApiWrite: () => Promise<unknown>
  isMachine: (header: string | null) => boolean
  list: typeof listProviderObservations
  save: typeof saveProviderObservation
}
const dependencies: ProviderObservationDeps = {
  requireApiAuth, requireApiWrite,
  isMachine: header => validIngestToken(header, process.env.COSTS_INGEST_TOKEN),
  list: listProviderObservations, save: saveProviderObservation,
}
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' }
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers })
}
export const MAX_OBSERVATION_BYTES = 131072
async function readBody(request: NextRequest): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new ProviderObservationError(400, 'Missing JSON body')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.length
      if (length > MAX_OBSERVATION_BYTES) {
        await reader.cancel()
        throw new RangeError('Body too large')
      }
      chunks.push(part.value)
    }
  } finally {
    reader.releaseLock()
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new ProviderObservationError(400, 'Invalid JSON body') }
}
export async function handleProviderObservations(request: NextRequest, method: 'GET' | 'POST', deps = dependencies) {
  try {
    const machine = deps.isMachine(request.headers.get('authorization'))
    if (method === 'GET') {
      if (!machine) await deps.requireApiAuth()
      const params = request.nextUrl.searchParams
      if (new Set(params.keys()).size !== Array.from(params.keys()).length) {
        throw new ProviderObservationError(400, 'Duplicate query parameters')
      }
      return json(await deps.list(providerObservationQuerySchema.parse(Object.fromEntries(params))))
    }
    if (!machine) {
      await deps.requireApiWrite()
      if (request.headers.get('origin') !== request.nextUrl.origin) return json({ error: 'Invalid origin' }, 403)
    }
    const result = await deps.save(await readBody(request))
    return json(result, result.status === 'added' ? 201 : 200)
  } catch (error) {
    if (error instanceof WriteAccessError) return json({ error: 'Write access required' }, 403)
    if (error instanceof Error && error.message === 'Authentication required') return json({ error: 'Authentication required' }, 401)
    if (error instanceof ProviderObservationError) return json({ error: error.message }, error.status)
    if (error instanceof ZodError) return json({
      error: 'Invalid provider observation fields or query',
      issues: error.issues.map(issue => ({ path: issue.path, message: issue.message })),
    }, 400)
    if (error instanceof RangeError && error.message === 'Body too large') return json({ error: `Record exceeds ${MAX_OBSERVATION_BYTES} bytes` }, 413)
    console.error('Provider observation request failed; no partial write committed')
    return json({ error: 'Provider observation request failed; try again' }, 500)
  }
}
