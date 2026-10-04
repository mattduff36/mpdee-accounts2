import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import { assignItraderIdentities } from '../../src/lib/costs/identity-reconcile'
import { decimalUnits } from '../../src/lib/costs/money'

const start = '2026-08-13T23:00:00.000Z'
const short = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 12)
const dollars = (units: bigint | null) => units === null ? null : (Number(units) / 1e7).toFixed(7)

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

function explainFunding(accountsKind: string, accountsFunding: string, writerFunding: string) {
  const writerIncluded = accountsKind === 'USAGE_EVENT_KIND_INCLUDED_IN_ULTRA'
  const accountsIncluded = ['USAGE_EVENT_KIND_INCLUDED_IN_ULTRA', 'USAGE_EVENT_KIND_INCLUDED_IN_PRO', 'USAGE_EVENT_KIND_INCLUDED_IN_PRO_PLUS'].includes(accountsKind)
  if (accountsIncluded && !writerIncluded && writerFunding === 'unresolved') {
    return 'Writer treats only INCLUDED_IN_ULTRA as included. This kind stays unresolved there and included in Accounts.'
  }
  if (accountsFunding !== writerFunding) return `Funding labels differ: Accounts ${accountsFunding}, writer ${writerFunding}.`
  return 'Funding labels agree.'
}

async function main() {
  const accountsEnv = { ...parseEnv('D:/Websites/mpdee-accounts2/.env'), ...parseEnv('D:/Websites/mpdee-accounts2/.env.local') }
  const itrader = parseEnv('D:/Websites/iommarket/.env.production')
  const accounts = await readOnly(accountsEnv.DATABASE_URL_UNPOOLED, async (db) => {
    const rows = await db.query(`
      SELECT e."accountRef", e."occurredAt", e."manualAssignment", coalesce(p.slug, 'unassigned') AS slug, e.attribution,
             coalesce(e.model, '') AS model, r.funding, r."nominalUnits"::text AS nominal, r.quality,
             r.evidence->>'kind' AS kind, r.evidence->>'timestamp' AS ts, r.evidence->>'conversationId' AS conversation_id,
             r.evidence->>'isTokenBasedCall' AS token_based, r.evidence->>'chargedCents' AS charged,
             r.evidence->'tokenUsage'->>'totalCents' AS total_cents,
             r.evidence->'tokenUsage'->>'inputTokens' AS in_tok, r.evidence->'tokenUsage'->>'outputTokens' AS out_tok,
             r.evidence->'tokenUsage'->>'cacheReadTokens' AS cache_read, r.evidence->'tokenUsage'->>'cacheWriteTokens' AS cache_write
      FROM "CostUsageEvent" e
      LEFT JOIN "CostProject" p ON p.id = e."projectId"
      JOIN LATERAL (SELECT * FROM "CostUsageRevision" WHERE "eventId" = e.id ORDER BY revision DESC LIMIT 1) r ON true
      WHERE e.provider = 'cursor' AND e."occurredAt" >= $1::timestamptz`, [start])
    const expenses = await db.query(`
      SELECT supplier, description, reference, "netAmount", "vatAmount", "grossAmount", to_char(date, 'YYYY-MM-DD') AS billed_date,
             ("receiptUrl" IS NOT NULL) AS has_receipt, ("invoiceId" IS NOT NULL) AS has_invoice,
             (notes IS NOT NULL AND length(notes) > 0) AS has_notes
      FROM "Expense"
      WHERE date >= '2026-08-13' AND "isArchived" = false
        AND (supplier ILIKE '%cursor%' OR supplier ILIKE '%vercel%' OR supplier ILIKE '%supabase%' OR description ILIKE '%cursor%' OR description ILIKE '%vercel%' OR description ILIKE '%supabase%')
      ORDER BY date, reference`)
    return { rows: rows.rows, expenses: expenses.rows }
  })
  const writer = await readOnly(itrader.POSTGRES_URL_NON_POOLING, async (db) => {
    const rows = await db.query(`
      SELECT id, "providerAccountRef" AS account, "fundingStatus" AS funding, "nominalUsd"::text AS nominal,
             "providerChargeUsd"::text AS provider_charge, "clientUsd"::text AS client, "projectId", model, "rawKind",
             "occurredAt"
      FROM "CostUsageEvent" WHERE "occurredAt" >= $1::timestamptz`, [start])
    const focus = await db.query(`
      WITH latest AS (
        SELECT DISTINCT ON (s."bucketKey")
          s."bucketKey" AS bucket, e."nativeAmount"::text AS amount, e."nativeCurrency" AS currency,
          e.category::text AS category, s.revision, s.classified, s.quarantined,
          to_char(e."servicePeriodStart", 'YYYY-MM-DD HH24:MI:SS') AS period_start,
          to_char(e."servicePeriodEnd", 'YYYY-MM-DD HH24:MI:SS') AS period_end
        FROM "CostSourceSnapshot" s
        JOIN "CostEntry" e ON e."sourceSnapshotId" = s.id AND e.kind = 'CHARGE'
        WHERE s."sourceKind" = 'VERCEL_FOCUS'
        ORDER BY s."bucketKey", s.revision DESC
      )
      SELECT count(*)::int AS latest_rows,
             count(*) FILTER (WHERE quarantined OR NOT classified)::int AS skipped_quality,
             count(*) FILTER (WHERE length(bucket) > 1000)::int AS too_long,
             count(*) FILTER (WHERE amount::numeric < 0)::int AS credit_rows,
             count(*) FILTER (WHERE amount::numeric = 0)::int AS zero_rows,
             coalesce(sum(amount::numeric) FILTER (WHERE amount::numeric > 0), 0)::text AS positive_usd,
             coalesce(sum(amount::numeric) FILTER (WHERE amount::numeric < 0), 0)::text AS credit_usd,
             coalesce(sum(amount::numeric), 0)::text AS net_usd,
             count(DISTINCT revision)::int AS revision_numbers,
             max(revision)::int AS max_revision
      FROM latest`)
    const revisions = await db.query(`
      SELECT count(*)::int AS snapshot_rows, count(DISTINCT "bucketKey")::int AS buckets,
             max(revision)::int AS max_revision
      FROM "CostSourceSnapshot" WHERE "sourceKind" = 'VERCEL_FOCUS'`)
    const overlap = await db.query(`
      WITH latest AS (
        SELECT DISTINCT ON (s."bucketKey")
          split_part(s."bucketKey", ':', 3) AS identity,
          e."displayLabel" AS service,
          e."nativeAmount"::numeric AS amount,
          e."servicePeriodStart" AS period_start,
          e."servicePeriodEnd" AS period_end
        FROM "CostSourceSnapshot" s
        JOIN "CostEntry" e ON e."sourceSnapshotId" = s.id AND e.kind = 'CHARGE'
        WHERE s."sourceKind" = 'VERCEL_FOCUS' AND s.classified AND NOT s.quarantined
        ORDER BY s."bucketKey", s.revision DESC
      )
      SELECT count(*)::int AS overlapping_pairs
      FROM latest a
      JOIN latest b ON a.identity = b.identity AND a.service = b.service AND a.period_start < b.period_end AND b.period_start < a.period_end
        AND (a.period_start, a.period_end, a.amount) < (b.period_start, b.period_end, b.amount)`)
    return { rows: rows.rows, focus: focus.rows[0], revisions: revisions.rows[0], overlap: overlap.rows[0] }
  })
  const shadow = await (async () => {
    const db = new pg.Client({ connectionString: 'postgresql://shadow@127.0.0.1:54329/mpdee_accounts_shadow' })
    await db.connect()
    try {
      await db.query('BEGIN READ ONLY')
    const rows = await db.query(`
      SELECT e.provider, e.attribution, r.quality, r.funding,
             count(*)::int AS events,
             count(*) FILTER (WHERE r."providerUnits" IS NULL)::int AS missing_provider,
             coalesce(sum(r."providerUnits"), 0)::text AS provider_units
      FROM "CostUsageEvent" e
      JOIN LATERAL (SELECT * FROM "CostUsageRevision" WHERE "eventId" = e.id ORDER BY revision DESC LIMIT 1) r ON true
      GROUP BY 1, 2, 3, 4
      ORDER BY 1, 2`)
    const fixture = await db.query(`SELECT count(*)::int AS snapshots, coalesce(sum("clientChargePence"), 0)::int AS pence FROM "CostChargeSnapshot"`)
      return { rows: rows.rows, fixture: fixture.rows[0] }
    } finally { await db.query('ROLLBACK'); await db.end() }
  })()

  const token = (value: unknown) => value === 'true' ? true : value === 'false' ? false : null
  const tokens = (value: unknown) => value === null || value === undefined || value === '' ? null : Number(value)
  const prepared = accounts.rows.map(row => ({
    accountRef: String(row.accountRef), timestamp: String(row.ts || new Date(row.occurredAt).toISOString()),
    model: String(row.model ?? ''), conversationId: row.conversation_id ? String(row.conversation_id) : null,
    kind: row.kind ? String(row.kind) : null, isTokenBasedCall: token(row.token_based),
    inputTokens: tokens(row.in_tok), outputTokens: tokens(row.out_tok), cacheReadTokens: tokens(row.cache_read), cacheWriteTokens: tokens(row.cache_write),
    slug: String(row.slug), funding: String(row.funding), nominal: row.nominal === null ? null : BigInt(row.nominal),
    charged: row.charged === null ? null : String(row.charged), totalCents: row.total_cents === null ? null : String(row.total_cents),
    manual: Boolean(row.manualAssignment), attribution: String(row.attribution), quality: String(row.quality),
  }))
  const assigned = assignItraderIdentities(prepared)
  const byIdentity = new Map(assigned.filter(row => row.identity && !row.ambiguous).map(row => [row.identity, row]))
  const writerById = new Map(writer.rows.map(row => [String(row.id), row]))
  const conflicts = []
  const accountsOnly = { itraderProject: 0, itraderNominal: BigInt(0), otherProject: 0, otherNominal: BigInt(0), unassigned: 0, unassignedNominal: BigInt(0) }
  for (const row of assigned) {
    if (!row.identity || row.ambiguous) continue
    const other = writerById.get(row.identity)
    if (!other) {
      const bucket = row.event.slug === 'itrader' ? 'itraderProject' : row.event.slug === 'unassigned' ? 'unassigned' : 'otherProject'
      accountsOnly[bucket] += 1
      accountsOnly[`${bucket === 'itraderProject' ? 'itraderNominal' : bucket === 'otherProject' ? 'otherNominal' : 'unassignedNominal'}`] += row.event.nominal ?? BigInt(0)
      continue
    }
    const writerNominal = other.nominal === null ? null : decimalUnits(String(other.nominal), 7)
    const funding = (row.event.funding === 'unknown' ? 'unresolved' : row.event.funding) !== String(other.funding)
    const amount = (row.event.nominal ?? null) !== writerNominal
    if (!funding && !amount && (row.event.slug === 'itrader') === (String(other.projectId ?? '') === 'itrader')) continue
    if (!funding && !amount) continue
    conflicts.push({
      identity: row.identity.slice(0, 12),
      account: short(row.event.accountRef),
      accountsKind: row.event.kind,
      writerKind: other.rawKind,
      accountsFunding: row.event.funding,
      writerFunding: other.funding,
      accountsNominalUsd: dollars(row.event.nominal),
      writerNominalUsd: other.nominal,
      writerProviderChargeUsd: other.provider_charge,
      writerClientUsd: other.client,
      totalCents: row.event.totalCents,
      chargedCents: row.event.charged,
      fundingNote: explainFunding(row.event.kind ?? '', row.event.funding, String(other.funding)),
      amountAgrees: !amount,
    })
  }
  const itraderOnly = writer.rows.filter(row => !byIdentity.has(String(row.id))).map(row => ({
    identity: String(row.id).slice(0, 12),
    account: short(String(row.account)),
    funding: row.funding,
    kind: row.rawKind,
    nominalUsd: row.nominal,
    providerChargeUsd: row.provider_charge,
    project: row.projectId,
    occurredAt: new Date(row.occurredAt).toISOString(),
  }))
  const fourth = new Map<string, { events: number; nominal: bigint; manual: number }>()
  for (const row of prepared.filter(row => short(row.accountRef) === '9cf957a2cad8')) {
    const current = fourth.get(row.slug) ?? { events: 0, nominal: BigInt(0), manual: 0 }
    current.events += 1
    current.nominal += row.nominal ?? BigInt(0)
    if (row.manual) current.manual += 1
    fourth.set(row.slug, current)
  }
  const artifact = {
    generatedAt: new Date().toISOString(),
    scope: { source: 'production read-only', cutoff: start, currency: 'USD', dataset: 'live-ledgers' },
    conflicts,
    accountsOnly: {
      attributableToItrader: { events: accountsOnly.itraderProject, nominalUsd: dollars(accountsOnly.itraderNominal) },
      otherProjects: { events: accountsOnly.otherProject, nominalUsd: dollars(accountsOnly.otherNominal) },
      unassigned: { events: accountsOnly.unassigned, nominalUsd: dollars(accountsOnly.unassignedNominal) },
    },
    itraderOnly,
    fourthAccount: Array.from(fourth, ([project, row]) => ({ project, events: row.events, nominalUsd: dollars(row.nominal), manualAssignments: row.manual })),
    infrastructure: { source: writer.focus, revisions: writer.revisions, overlappingPairs: writer.overlap.overlapping_pairs },
    shadowFixtureDatabase: { groups: shadow.rows, approvedSnapshotPence: shadow.fixture.pence, approvedSnapshots: shadow.fixture.snapshots },
    expenses: accounts.expenses.map(row => ({
      supplier: row.supplier, description: row.description, reference: row.reference,
      netPence: row.netAmount, vatPence: row.vatAmount, grossPence: row.grossAmount,
      date: row.billed_date, hasReceipt: row.has_receipt, hasInvoiceLink: row.has_invoice, hasNotes: row.has_notes,
    })),
  }
  writeFileSync('D:/Websites/mpdee-accounts2/docs/costs/live-shadow-stage3.json', JSON.stringify(artifact, null, 2))
  console.log(JSON.stringify({
    conflicts: conflicts.length,
    funding: conflicts.filter(row => !row.amountAgrees ? false : true).length,
    amountConflicts: conflicts.filter(row => !row.amountAgrees).length,
    accountsOnly: artifact.accountsOnly,
    itraderOnly: itraderOnly.length,
    fourth: artifact.fourthAccount,
    infrastructure: artifact.infrastructure,
    expenses: artifact.expenses.length,
  }, null, 2))
}
main()
