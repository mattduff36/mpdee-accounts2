import { NextRequest, NextResponse } from 'next/server'
import { requireApiWrite } from '@/lib/auth'
import { importUsage } from '@/lib/costs/service'
import { validIngestToken } from '@/lib/costs/machine-auth'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function POST(request: NextRequest) {
  let userId: string | undefined
  const machine = validIngestToken(request.headers.get('authorization'), process.env.COSTS_INGEST_TOKEN)
  if (!machine) {
    try { userId = (await requireApiWrite()).id } catch { return NextResponse.json({ error: 'Write access required' }, { status: 403 }) }
    if (request.headers.get('origin') !== request.nextUrl.origin) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  }
  const reader = request.body?.getReader()
  if (!reader) return NextResponse.json({ error: 'Missing body' }, { status: 400 })
  const chunks: Uint8Array[] = []
  let bytes = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    bytes += part.value.length
    if (bytes > 3_000_000) { await reader.cancel(); return NextResponse.json({ error: 'Import exceeds 3 MB; split into daily files' }, { status: 413 }) }
    chunks.push(part.value)
  }
  let input: unknown
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  try { return NextResponse.json(await importUsage(input, userId)) }
  catch { return NextResponse.json({ error: 'Import rejected. Check the documented format, date, amounts and database migration. No partial import was saved.' }, { status: 400 }) }
}
