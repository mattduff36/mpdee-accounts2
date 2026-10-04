import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import pg from 'pg'
import { billCoverage, sourceDateFromNotes, unresolvedCoverageText } from '../../src/lib/costs/bill-coverage'
import { bookTimeInLedger } from '../../src/lib/costs/ledger-window'
import { cursorBaseKey } from '../../src/lib/costs/normalize'
import { populationText, refreshOutcome, summariseRefreshPopulation, workspaceRefForSlug, type RefreshSourceRow } from '../../src/lib/costs/refresh-population'
import { assertRealShadow } from './shadow-target'

const cutoff = '2026-08-13T23:00:00.000Z'
const realFile = 'D:/Websites/mpdee-accounts2/.env.shadow.real'

function parseEnv(file: string) {
  const out: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const index = trimmed.indexOf('=')
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    out[trimmed.slice(0, index).trim()] = value
  }
  return out
}

function remoteConfig(raw: string) {
  const url = new URL(raw)
  url.searchParams.delete('sslmode')
  url.searchParams.delete('ssl')
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: false } }
}

type CursorEvent = { timestamp: string; model?: string; conversationId?: string | null; kind?: string | null; isTokenBasedCall?: boolean | null; chargedCents?: string | null; tokenUsage?: { totalCents?: string | null; inputTokens?: number | null; outputTokens?: number | null; cacheReadTokens?: number | null; cacheWriteTokens?: number | null } | null; workspaceRef?: string }

function asEvent(evidence: unknown, slug: string): CursorEvent | null {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null
  const event = evidence as Record<string, unknown>
  const tokenUsage = event.tokenUsage && typeof event.tokenUsage === 'object' && !Array.isArray(event.tokenUsage) ? event.tokenUsage as Record<string, unknown> : null
  const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
  return {
    timestamp: String(event.timestamp ?? ''),
    model: typeof event.model === 'string' ? event.model : undefined,
    conversationId: typeof event.conversationId === 'string' ? event.conversationId : null,
    kind: typeof event.kind === 'string' ? event.kind : null,
    isTokenBasedCall: typeof event.isTokenBasedCall === 'boolean' ? event.isTokenBasedCall : null,
    chargedCents: event.chargedCents === null || event.chargedCents === undefined ? null : String(event.chargedCents),
    tokenUsage: tokenUsage ? {
      totalCents: tokenUsage.totalCents === null || tokenUsage.totalCents === undefined ? null : String(tokenUsage.totalCents),
      inputTokens: numberOrNull(tokenUsage.inputTokens), outputTokens: numberOrNull(tokenUsage.outputTokens),
      cacheReadTokens: numberOrNull(tokenUsage.cacheReadTokens), cacheWriteTokens: numberOrNull(tokenUsage.cacheWriteTokens),
    } : null,
    workspaceRef: workspaceRefForSlug(slug) ?? undefined,
  }
}

async function main() {
  const local = parseEnv(realFile)
  assertRealShadow(local.DATABASE_URL)
  process.env.DATABASE_URL = local.DATABASE_URL
  process.env.DATABASE_URL_UNPOOLED = local.DATABASE_URL
  process.env.DIRECT_URL = local.DATABASE_URL
  const run = (args: string[]) => execFileSync('npx', args, { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' })
  if (!existsSync('node_modules/.prisma/client/query_engine-windows.dll.node')) run(['prisma', 'generate'])
  run(['prisma', 'migrate', 'deploy'])
  const [{ prisma }, { importUsage }, { loadCostFigures }, { syncReconciliationIssues }] = await Promise.all([
    import('../../src/lib/db'),
    import('../../src/lib/costs/service'),
    import('../../src/lib/costs/figures-load'),
    import('../../src/lib/costs/reconciliation-sync'),
  ])
  const sourceEnv = parseEnv('D:/Websites/mpdee-accounts2/.env')
  const sourceUrl = sourceEnv.DATABASE_URL_UNPOOLED || sourceEnv.DATABASE_URL
  let unavailable = 'Automatic collection is not running. Infrastructure already in this database stays. A new writer export is a manual file and is not read from the iTrader checkout.'
  let added = 0
  let duplicate = 0
  const sourceIdentity = (() => { try { return new URL(sourceUrl) } catch { return null } })()
  const sourceIsRemote = Boolean(sourceIdentity && sourceIdentity.hostname !== '127.0.0.1' && sourceIdentity.hostname !== 'localhost')
  if (sourceIsRemote && sourceUrl) {
    const source = new pg.Client(remoteConfig(sourceUrl))
    await source.connect()
    await source.query('BEGIN READ ONLY')
    const usage = await source.query(`SELECT e."accountRef", coalesce(p.slug, 'unassigned') AS slug, r.evidence FROM "CostUsageEvent" e LEFT JOIN "CostProject" p ON p.id = e."projectId" JOIN LATERAL (SELECT evidence FROM "CostUsageRevision" WHERE "eventId" = e.id ORDER BY revision DESC LIMIT 1) r ON true WHERE e.provider = 'cursor' AND e."occurredAt" >= $1::timestamptz`, [cutoff])
    const usageCoverage = await source.query(`SELECT count(*)::int AS rows, max("occurredAt") AS latest FROM "CostUsageEvent" WHERE provider = 'cursor' AND "occurredAt" >= $1::timestamptz`, [cutoff])
    const expenses = await source.query(`SELECT id, to_char(date, 'YYYY-MM-DD HH24:MI:SS') AS booked, supplier, description, notes, "netAmount", "vatAmount", "grossAmount", "vatRate", reference FROM "Expense" WHERE "isArchived" = false AND date >= '2026-08-13' AND (supplier ILIKE '%cursor%' OR supplier ILIKE '%vercel%' OR supplier ILIKE '%supabase%')`)
    await source.query('ROLLBACK')
    await source.end()
    const user = await prisma.user.findUniqueOrThrow({ where: { email: local.SHADOW_LOGIN_EMAIL } })
    const client = await prisma.client.upsert({ where: { id: 'shadow-client' }, update: {}, create: { id: 'shadow-client', name: 'Shadow client' } })
    const slugs = Array.from(new Set(usage.rows.map(row => String(row.slug)).filter(slug => slug !== 'unassigned' && /^[a-z0-9-]+$/.test(slug))))
    for (const slug of slugs) {
      const project = await prisma.costProject.upsert({ where: { slug }, update: { archived: false }, create: { slug, name: slug, clientId: client.id } })
      const value = slug === 'itrader' ? 'itrader-attributed' : `attributed:${slug}`
      await prisma.costProjectMapping.upsert({ where: { type_value: { type: 'workspace', value } }, update: { projectId: project.id }, create: { type: 'workspace', value, projectId: project.id } })
    }
    const storedRows = await prisma.costUsageEvent.findMany({ where: { provider: 'cursor' }, select: { accountRef: true, sourceKey: true } })
    const remaining = new Map<string, number>()
    for (const stored of storedRows) {
      const key = `${stored.accountRef}|${stored.sourceKey.replace(/:\d+$/, '')}`
      remaining.set(key, (remaining.get(key) ?? 0) + 1)
    }
    const knownBases = new Set(remaining.keys())
    const classified = usage.rows.map(row => {
      const evidence = row.evidence
      const readable = Boolean(evidence && typeof evidence === 'object' && !Array.isArray(evidence))
      const ref = String(row.accountRef)
      const valid = /^[a-zA-Z0-9_-]{3,100}$/.test(ref)
      let storedLocally = false
      if (readable && valid) {
        const record = evidence as { timestamp?: string | number; model?: string | null; conversationId?: string | null; isTokenBasedCall?: boolean | null }
        if (typeof record.timestamp !== 'string' && typeof record.timestamp !== 'number') throw new Error('Invalid event date')
        const key = `${ref}|${cursorBaseKey({ timestamp: record.timestamp, model: record.model, conversationId: record.conversationId, isTokenBasedCall: record.isTokenBasedCall })}`
        const left = remaining.get(key) ?? 0
        if (left > 0) { storedLocally = true; remaining.set(key, left - 1) }
        else if (knownBases.has(key)) throw new Error('A new usage event shares an identity prefix with a stored event. Refresh stopped before writing.')
      }
      const sourceRow: RefreshSourceRow = { slug: String(row.slug), accountValid: valid, evidenceReadable: readable, storedLocally }
      return { row, sourceRow }
    })
    const population = summariseRefreshPopulation(classified.map(item => item.sourceRow))
    const category = await prisma.expenseCategory.upsert({ where: { name: 'Provider bills' }, update: {}, create: { name: 'Provider bills' } })
    const unresolvedBills: { reference: string; grossPence: number; booked: string; sourceDate: string | null }[] = []
    for (const expense of expenses.rows) {
      const booked = String(expense.booked)
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(booked)) throw new Error('Unreadable expense date')
      if (bookTimeInLedger(booked)) continue
      const originalNotes = expense.notes ? String(expense.notes) : null
      const sourceDate = sourceDateFromNotes(originalNotes)
      const coverage = billCoverage({ reference: String(expense.reference ?? ''), booked, grossPence: Number(expense.grossAmount), sourceDate, periodStart: null, periodEnd: null })
      if (coverage.treatment !== 'unresolved') continue
      const id = String(expense.id)
      const reference = expense.reference ? String(expense.reference) : 'No reference'
      const grossPence = Number(expense.grossAmount)
      unresolvedBills.push({ reference, grossPence, booked, sourceDate })
      const description = String(expense.description)
      const data = { date: new Date(`${booked.replace(' ', 'T')}Z`), supplier: expense.supplier ? String(expense.supplier) : null, description: description.includes('@') ? 'Description omitted because it contains an address.' : description, netAmount: Number(expense.netAmount), vatAmount: Number(expense.vatAmount), grossAmount: grossPence, vatRate: Number(expense.vatRate), reference: expense.reference ? String(expense.reference) : null, notes: originalNotes }
      const existing = await prisma.expense.findUnique({ where: { id }, select: { id: true } })
      if (existing) await prisma.expense.update({ where: { id }, data })
      else await prisma.expense.create({ data: { id, categoryId: category.id, ...data } })
    }
    const includedExpenses = expenses.rows.filter(expense => bookTimeInLedger(String(expense.booked)))
    for (const expense of includedExpenses) {
      const id = String(expense.id)
      const booked = String(expense.booked)
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(booked)) throw new Error('Unreadable expense date')
      const date = new Date(`${booked.replace(' ', 'T')}Z`)
      const description = String(expense.description)
      const amounts = { date, supplier: expense.supplier ? String(expense.supplier) : null, description: description.includes('@') ? 'Description omitted because it contains an address.' : description, netAmount: Number(expense.netAmount), vatAmount: Number(expense.vatAmount), grossAmount: Number(expense.grossAmount), vatRate: Number(expense.vatRate), reference: expense.reference ? String(expense.reference) : null }
      const existing = await prisma.expense.findUnique({ where: { id }, select: { id: true } })
      if (existing) {
        await prisma.expense.update({ where: { id }, data: amounts })
        continue
      }
      await prisma.expense.create({ data: { id, categoryId: category.id, ...amounts, notes: 'Original provider document is not in this database. The invoice date is not a billing period.' } })
    }
    const byAccount = new Map<string, CursorEvent[]>()
    for (const item of classified) {
      if (refreshOutcome(item.sourceRow) !== 'copied') continue
      const event = asEvent(item.row.evidence, item.sourceRow.slug)
      if (!event) continue
      const ref = String(item.row.accountRef)
      const list = byAccount.get(ref) ?? []
      list.push(event)
      byAccount.set(ref, list)
    }
    const payloads = Array.from(byAccount, ([accountRef, events]) => ({ provider: 'cursor' as const, accountRef, quality: 'complete' as const, events }))
    const packed = payloads.flatMap(payload => Array.from({ length: Math.ceil(payload.events.length / 400) }, (_, index) => ({ ...payload, events: payload.events.slice(index * 400, index * 400 + 400) })))
    for (const chunk of packed) {
      const result = await importUsage(chunk, user.id)
      added += result.added
    }
    for (const chunk of packed) {
      const result = await importUsage(chunk, user.id)
      if (result.added !== 0) throw new Error('Refresh replay added rows')
      duplicate += result.duplicate
    }
    if (added !== population.copied) throw new Error('Copied usage did not match the source population')
    const cursorLatest = usageCoverage.rows[0]?.latest ? new Date(usageCoverage.rows[0].latest).toISOString() : 'none'
    const coverageText = unresolvedBills.length ? unresolvedBills.map(bill => unresolvedCoverageText(bill)).join(' ') : 'No provider bill is waiting on a service period.'
    unavailable = `Read-only accounts book. Cursor latest ${cursorLatest}. ${populationText(population, { added: 0, duplicate })}. ${coverageText} Infrastructure collection is manual and was not read on this run. Automatic collection is not running. The writer is not contacted.`
  }
  const infraLatestRows = await prisma.$queryRaw<{ latest: Date | null }[]>`SELECT max("occurredAt") AS latest FROM "CostUsageEvent" WHERE provider = 'vercel' AND "occurredAt" >= ${new Date(cutoff)}`
  const infraLatest = infraLatestRows[0]?.latest ? new Date(infraLatestRows[0].latest).toISOString() : 'none'
  unavailable += ` Latest stored infrastructure event: ${infraLatest}. This command writes only to 127.0.0.1:54329/mpdee_accounts_shadow_real.`
  const summary = await loadCostFigures()
  await syncReconciliationIssues(summary)
  await prisma.costRefreshStatus.upsert({
    where: { id: 'current' },
    create: { id: 'current', finishedAt: new Date(), sourceNote: sourceIsRemote ? 'Accounts book, read-only' : 'Local ledger only', added, duplicate, unavailableNote: unavailable },
    update: { finishedAt: new Date(), sourceNote: sourceIsRemote ? 'Accounts book, read-only' : 'Local ledger only', added, duplicate, unavailableNote: unavailable },
  })
  console.log(JSON.stringify({ added, duplicate, projects: summary.projects.length, bills: summary.providerBills, billPence: summary.providerBillPence, unresolvedBills: summary.unresolvedBills.map(bill => bill.reference), unassignedInfrastructure: summary.unassignedInfrastructureRows, source: sourceIsRemote ? 'accounts-book' : 'local-only' }, null, 2))
  await prisma.$disconnect()
}

main()
