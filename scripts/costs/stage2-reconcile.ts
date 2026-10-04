import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import { assignItraderIdentities, explainAccountCoverage, explainStatusOverlap, reconcileIdentities, type IdentityRecord } from '../../src/lib/costs/identity-reconcile'
import { matchProviderBills, allocationConserves, type ProviderBill } from '../../src/lib/costs/bill-match'
import { reviewInvoiceCredit, reviewClientAdjustment, refuseNaiveTimezoneCorrection } from '../../src/lib/costs/historical-reconcile'
import { decimalUnits } from '../../src/lib/costs/money'

function parseEnv(file: string) {
  const out: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const i = t.indexOf('=')
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[t.slice(0, i).trim()] = v
  }
  return out
}
function connectionConfig(raw: string) {
  const url = new URL(raw)
  url.searchParams.delete('sslmode')
  url.searchParams.delete('ssl')
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: false } }
}
async function readOnly<T>(raw: string, fn: (db: pg.Client) => Promise<T>) {
  const db = new pg.Client(connectionConfig(raw))
  await db.connect()
  try {
    await db.query('BEGIN READ ONLY')
    await db.query("SET LOCAL statement_timeout = '120s'")
    const result = await fn(db)
    await db.query('ROLLBACK')
    return result
  } finally { await db.end() }
}
const short = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 12)
const start = '2026-08-13T23:00:00.000Z'
const num = (value: string | null) => value === null || value === '' ? null : Number(value)

async function main() {
  const accountsEnv = { ...parseEnv('D:/Websites/mpdee-accounts2/.env'), ...parseEnv('D:/Websites/mpdee-accounts2/.env.local') }
  const itrader = parseEnv('D:/Websites/iommarket/.env.production')
  const accounts = await readOnly(accountsEnv.DATABASE_URL_UNPOOLED, async (db) => {
    const fx = await db.query(`SELECT (SELECT count(*)::int FROM "CostUsageRevision") AS revisions, (SELECT count("fxGbp")::int FROM "CostUsageRevision") AS revision_rates, (SELECT count(*)::int FROM "CostFxRate") AS table_rates`)
    const rows = await db.query(`
      SELECT e."accountRef", e."occurredAt", coalesce(p.slug, 'unassigned') AS slug, e.attribution, coalesce(e.model, '') AS model,
             r.funding, r."nominalUnits"::text AS nominal, r.quality, (r."fxGbp" IS NOT NULL) AS has_fx, r.currency,
             r.evidence->>'timestamp' AS ts, r.evidence->>'kind' AS kind, r.evidence->>'isTokenBasedCall' AS token_based,
             r.evidence->>'conversationId' AS conversation_id,
             r.evidence->'tokenUsage'->>'inputTokens' AS in_tok, r.evidence->'tokenUsage'->>'outputTokens' AS out_tok,
             r.evidence->'tokenUsage'->>'cacheReadTokens' AS cache_read, r.evidence->'tokenUsage'->>'cacheWriteTokens' AS cache_write
      FROM "CostUsageEvent" e
      LEFT JOIN "CostProject" p ON p.id = e."projectId"
      JOIN LATERAL (SELECT * FROM "CostUsageRevision" WHERE "eventId" = e.id ORDER BY revision DESC LIMIT 1) r ON true
      WHERE e.provider = 'cursor' AND e."occurredAt" >= $1::timestamptz`, [start])
    const span = await db.query(`SELECT count(*) FILTER (WHERE "occurredAt" < $1::timestamptz)::int AS before_cutoff, count(*) FILTER (WHERE "occurredAt" >= $1::timestamptz)::int AS in_window FROM "CostUsageEvent" WHERE provider = 'cursor'`, [start])
    const expenses = await db.query(`
      SELECT id, supplier, description, "netAmount", reference IS NULL AS reference_missing, "invoiceId" IS NULL AS invoice_missing
      FROM "Expense" WHERE date >= '2026-08-13' AND "isArchived" = false
        AND (supplier ILIKE '%cursor%' OR supplier ILIKE '%vercel%' OR supplier ILIKE '%supabase%')`)
    return { fx: fx.rows[0], rows: rows.rows, span: span.rows[0], expenses: expenses.rows }
  })
  const writer = await readOnly(itrader.POSTGRES_URL_NON_POOLING, async (db) => {
    const rows = await db.query(`
      SELECT id, "providerAccountRef" AS account, "fundingStatus" AS funding, "nominalUsd"::text AS nominal, "projectId", model, "rawKind"
      FROM "CostUsageEvent" WHERE "occurredAt" >= $1::timestamptz`, [start])
    const chain = await db.query(`
      SELECT id, kind::text, "markedGbpMinor"::text AS gbp, "reversesEntryId"
      FROM "CostEntry" WHERE "displayLabel" = 'Previous invoice already paid.'`)
    const entryLabel = process.env.COST_SHADOW_ENTRY_LABEL
    const ripple = entryLabel
      ? await db.query(`SELECT count(*)::int AS rows FROM "CostEntry" WHERE "displayLabel" = $1`, [entryLabel])
      : { rows: [{ rows: null }] }
    const infra = await db.query(`
      SELECT count(*) FILTER (WHERE "bucketKey" LIKE 'vercel:membership:%')::int AS membership,
             count(*) FILTER (WHERE "sourceKind"::text = 'VERCEL_FOCUS')::int AS focus
      FROM "CostSourceSnapshot"`)
    return { rows: rows.rows, chain: chain.rows, ripple: ripple.rows[0], infra: infra.rows[0] }
  })

  const token = (value: unknown) => value === 'true' ? true : value === 'false' ? false : null
  const tokens = (value: unknown) => value === null || value === undefined || value === '' ? null : Number(value)
  const prepared = accounts.rows.map(row => ({
    accountRef: String(row.accountRef),
    timestamp: String(row.ts || new Date(row.occurredAt).toISOString()),
    model: String(row.model ?? ''),
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
    kind: row.kind ? String(row.kind) : null,
    isTokenBasedCall: token(row.token_based),
    inputTokens: tokens(row.in_tok), outputTokens: tokens(row.out_tok), cacheReadTokens: tokens(row.cache_read), cacheWriteTokens: tokens(row.cache_write),
    slug: String(row.slug), funding: String(row.funding), nominal: row.nominal === null ? null : BigInt(row.nominal),
    quality: String(row.quality), hasFx: Boolean(row.has_fx), attribution: String(row.attribution),
  }))
  const assigned = assignItraderIdentities(prepared)
  const accountsRecords: IdentityRecord[] = assigned.map(row => ({
    identity: row.identity, accountRef: short(row.event.accountRef), projectId: row.event.slug === 'unassigned' ? null : row.event.slug,
    funding: row.event.funding === 'unknown' ? 'unresolved' : row.event.funding, nominalUnits: row.event.nominal, ambiguous: row.ambiguous,
  }))
  const itraderRecords: IdentityRecord[] = writer.rows.map(row => ({
    identity: String(row.id), accountRef: short(String(row.account)), projectId: row.projectId ? String(row.projectId) : null,
    funding: String(row.funding), nominalUnits: row.nominal === null ? null : decimalUnits(String(row.nominal), 7),
  }))
  const identity = reconcileIdentities(accountsRecords, itraderRecords)
  const coverage = explainAccountCoverage([
    ...prepared.map(row => ({ accountRef: short(row.accountRef), side: 'accounts' as const, nominalUnits: row.nominal ?? BigInt(0), projectId: row.slug === 'unassigned' ? null : row.slug })),
    ...writer.rows.map(row => ({ accountRef: short(String(row.account)), side: 'itrader' as const, nominalUnits: row.nominal === null ? BigInt(0) : decimalUnits(String(row.nominal), 7), projectId: row.projectId ? String(row.projectId) : null })),
  ])
  const itraderAccounts = new Set(writer.rows.map(row => String(row.account)))
  const scoped = prepared.filter(row => row.slug === 'itrader' || (row.slug === 'unassigned' && itraderAccounts.has(row.accountRef)))
  const overlap = explainStatusOverlap(scoped.map(row => {
    const unassigned = row.slug === 'unassigned' || row.attribution === 'conflict'
    const held = row.quality !== 'complete' || row.funding === 'unknown' || unassigned
    return { unassigned, held, fxMissing: !held && !row.hasFx }
  }))
  const bills: ProviderBill[] = accounts.expenses.map(row => ({
    id: short(String(row.id)), provider: /vercel/i.test(String(row.supplier)) ? 'vercel' : /supabase/i.test(String(row.supplier)) ? 'supabase' : 'cursor',
    accountRef: null, service: /subscription/i.test(String(row.description)) ? 'subscription' as const : /on-demand/i.test(String(row.description)) ? 'on-demand' as const : 'infrastructure' as const,
    periodStart: '2026-08-13T23:00:00.000Z', periodEnd: '2026-10-04T00:00:00.000Z', netPence: Number(row.netAmount),
  }))
  const matchedBills = matchProviderBills(bills, [])
  const chain = writer.chain.map(row => ({ id: short(String(row.id)), kind: row.kind === 'REVERSAL' ? 'REVERSAL' as const : 'CHARGE' as const, amountPence: Number(row.gbp), reversesId: row.reversesEntryId ? short(String(row.reversesEntryId)) : null }))
  const credit = reviewInvoiceCredit({
    chain,
    invoice: { amountPence: chain.find(row => row.kind === 'CHARGE' && row.amountPence > 0)?.amountPence ?? 0, sameClient: true, projectLinked: false },
  })
  const artifact = {
    generatedAt: new Date().toISOString(),
    identity: { ...identity, ambiguousIdentities: assigned.filter(row => row.ambiguous).length },
    accounts: { ...coverage, eventsBeforeCutoff: accounts.span.before_cutoff, eventsInWindow: accounts.span.in_window },
    overlap,
    fxStorage: accounts.fx,
    bills: { count: bills.length, conserved: allocationConserves(bills, matchedBills), unallocatedPence: matchedBills.unallocated.reduce((total, row) => total + row.pence, 0), suppressed: matchedBills.suppressedEventIds.length, referenceMissing: accounts.expenses.filter(row => row.reference_missing).length },
    paymentCredit: credit,
    ripple: reviewClientAdjustment({ amountPence: writer.ripple.rows == null ? 0 : 1, usageEvidence: 'unknown' }),
    rippleRows: writer.ripple.rows,
    naiveTimestamp: refuseNaiveTimezoneCorrection('2026-09-01 07:00:00'),
    infrastructureSnapshots: writer.infra,
  }
  writeFileSync('D:/Websites/mpdee-accounts2/docs/costs/live-shadow-stage2.json', JSON.stringify(artifact, null, 2))
  console.log(JSON.stringify({ identity, overlap, fx: accounts.fx, bills: artifact.bills, credit, fourth: artifact.accounts.accountsOnly.map(row => ({ events: row.events, projects: row.projects })) }, null, 2))
}
main()
