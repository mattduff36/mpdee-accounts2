import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireApiWrite } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { CSV_MAX_BYTES, parseCursorCsv } from '@/lib/costs/csv-evidence'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function POST(request: NextRequest) {
  let userId: string
  try { userId = (await requireApiWrite()).id } catch { return NextResponse.json({ error: 'Write access required' }, { status: 403 }) }
  if (request.headers.get('origin') !== request.nextUrl.origin) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  const reader = request.body?.getReader()
  if (!reader) return NextResponse.json({ error: 'Missing CSV import' }, { status: 400 })
  const chunks: Uint8Array[] = []
  let bytes = 0
  // JSON escaping roughly doubles a quoted CSV. The CSV itself has a separate 3 MB cap.
  while (true) {
    const part = await reader.read()
    if (part.done) break
    bytes += part.value.length
    if (bytes > CSV_MAX_BYTES * 2 + 4096) { await reader.cancel(); return NextResponse.json({ error: 'Import too large' }, { status: 413 }) }
    chunks.push(part.value)
  }
  let parsed: ReturnType<typeof parseCursorCsv>
  try { parsed = parseCursorCsv(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
  catch { return NextResponse.json({ error: 'Invalid Cursor CSV. Select an account and an unchanged usage export, up to 3 MB and 15,000 rows.' }, { status: 400 }) }
  try {
    const result = await prisma.$transaction(async tx => {
      let added = 0
      for (let offset = 0; offset < parsed.rows.length; offset += 500) {
        const batch = parsed.rows.slice(offset, offset + 500).map(row => ({ ...row, accountEmail: parsed.accountEmail, sourceFile: parsed.sourceFile, sourceSha256: parsed.sourceSha256 }))
        added += (await tx.costUsageEvidence.createMany({ data: batch, skipDuplicates: true })).count
      }
      const linked = await tx.costUsageEvidence.count({ where: { accountEmail: parsed.accountEmail, fingerprint: { in: parsed.rows.map(row => row.fingerprint) }, linkedEventId: { not: null } } })
      const report = { received: parsed.received, added, duplicate: parsed.received - added, linked, pending: parsed.rows.length - linked }
      await tx.auditLog.create({ data: { userId, action: 'costs.csv.evidence.import', entityType: 'CostUsageEvidence', details: JSON.stringify({ ...report, accountEmail: parsed.accountEmail, sourceFile: parsed.sourceFile, sourceSha256: parsed.sourceSha256 }) } })
      return report
    }, { timeout: 60000 })
    revalidatePath('/costs'); revalidatePath('/costs/import'); revalidatePath('/costs/evidence')
    return NextResponse.json(result)
  } catch { return NextResponse.json({ error: 'Evidence could not be saved. Please retry; imports are duplicate-safe.' }, { status: 500 }) }
}
