import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { requireApiAuth, requireApiWrite, WriteAccessError } from '@/lib/auth'
import { validIngestToken } from '@/lib/costs/machine-auth'
import { customRecurringQuerySchema, CustomRecurringError, type CustomRecurringActor } from '@/lib/costs/custom-recurring'
import { listCustomRecurring, saveCustomRecurring } from '@/lib/costs/custom-recurring-store'

export type CustomRecurringDeps = {
  requireApiAuth: () => Promise<unknown>
  requireApiWrite: () => Promise<{ id: string }>
  isMachine: (header: string | null) => boolean
  list: typeof listCustomRecurring
  save: typeof saveCustomRecurring
}
const dependencies: CustomRecurringDeps = {
  requireApiAuth, requireApiWrite,
  isMachine: header => validIngestToken(header, process.env.COSTS_INGEST_TOKEN),
  list: listCustomRecurring, save: saveCustomRecurring,
}
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' }
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers })
}
async function readBody(request: NextRequest): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new CustomRecurringError(400, 'Missing JSON body')
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
  } finally {
    reader.releaseLock()
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new CustomRecurringError(400, 'Invalid JSON body') }
}
export async function handleCustomRecurring(request: NextRequest, method: 'GET' | 'POST' | 'PATCH', deps = dependencies) {
  try {
    let actor: CustomRecurringActor | undefined
    if (method === 'GET') {
      if (!deps.isMachine(request.headers.get('authorization'))) await deps.requireApiAuth()
      const params = request.nextUrl.searchParams
      if (new Set(params.keys()).size !== Array.from(params.keys()).length) {
        throw new CustomRecurringError(400, 'Duplicate query parameters')
      }
      return json(await deps.list(customRecurringQuerySchema.parse(Object.fromEntries(params))))
    }
    if (method === 'POST' && deps.isMachine(request.headers.get('authorization'))) {
      actor = { actorType: 'machine', actorId: null }
    } else {
      const user = await deps.requireApiWrite()
      if (request.headers.get('origin') !== request.nextUrl.origin) return json({ error: 'Invalid origin' }, 403)
      actor = { actorType: 'user', actorId: user.id }
    }
    const result = await deps.save(await readBody(request), actor, method === 'POST' ? 'create' : 'edit')
    return json(result, result.status === 'added' ? 201 : 200)
  } catch (error) {
    if (error instanceof WriteAccessError) return json({ error: 'Write access required' }, 403)
    if (error instanceof Error && error.message === 'Authentication required') return json({ error: 'Authentication required' }, 401)
    if (error instanceof CustomRecurringError) return json({ error: error.message }, error.status)
    if (error instanceof ZodError) return json({ error: 'Invalid recurring cost fields or query', issues: error.issues.map(issue => ({ path: issue.path, message: issue.message })) }, 400)
    if (error instanceof RangeError && error.message === 'Body too large') return json({ error: 'Record exceeds 16384 bytes' }, 413)
    console.error('Custom recurring cost request failed; no partial write committed')
    return json({ error: 'Recurring cost request failed; try again' }, 500)
  }
}
