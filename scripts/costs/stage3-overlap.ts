import { readFileSync } from 'node:fs'
import pg from 'pg'

function env(file: string) {
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

async function main() {
  const itrader = env('D:/Websites/iommarket/.env.production')
  const accounts = { ...env('D:/Websites/mpdee-accounts2/.env'), ...env('D:/Websites/mpdee-accounts2/.env.local') }
  const url = new URL(itrader.POSTGRES_URL_NON_POOLING)
  url.searchParams.delete('sslmode')
  url.searchParams.delete('ssl')
  const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } })
  await db.connect()
  await db.query('BEGIN READ ONLY')
  await db.query("SET LOCAL statement_timeout = '90s'")
  const overlap = await db.query(`
    WITH latest AS (
      SELECT DISTINCT ON (s."bucketKey")
        regexp_replace(s."bucketKey", ':[^:]+:[^:]+$', '') AS charge_key,
        e."servicePeriodStart" AS period_start,
        e."servicePeriodEnd" AS period_end
      FROM "CostSourceSnapshot" s
      JOIN "CostEntry" e ON e."sourceSnapshotId" = s.id AND e.kind = 'CHARGE'
      WHERE s."sourceKind" = 'VERCEL_FOCUS' AND s.classified AND NOT s.quarantined
      ORDER BY s."bucketKey", s.revision DESC
    )
    SELECT (SELECT count(*)::int FROM latest) AS rows,
           (SELECT count(DISTINCT charge_key)::int FROM latest) AS charge_keys,
           (SELECT count(*)::int FROM latest a JOIN latest b
             ON a.charge_key = b.charge_key
            AND a.period_start < b.period_end AND b.period_start < a.period_end
            AND (a.period_start, a.period_end) < (b.period_start, b.period_end)) AS overlapping_pairs`)
  const missing = await db.query(`SELECT count(*)::int AS buckets_without_charge FROM "CostSourceSnapshot" s WHERE s."sourceKind" = 'VERCEL_FOCUS' AND NOT EXISTS (SELECT 1 FROM "CostEntry" e WHERE e."sourceSnapshotId" = s.id AND e.kind = 'CHARGE')`)
  await db.query('ROLLBACK')
  await db.end()
  const accountsUrl = new URL(accounts.DATABASE_URL_UNPOOLED)
  accountsUrl.searchParams.delete('sslmode')
  accountsUrl.searchParams.delete('ssl')
  const adb = new pg.Client({ connectionString: accountsUrl.toString(), ssl: { rejectUnauthorized: false } })
  await adb.connect()
  await adb.query('BEGIN READ ONLY')
  const refs = await adb.query(`SELECT count(DISTINCT "accountRef") FILTER (WHERE "accountRef" ~ '^[A-Za-z0-9_-]+$')::int AS safe, count(DISTINCT "accountRef") FILTER (WHERE "accountRef" LIKE '%@%')::int AS with_at, count(DISTINCT "accountRef")::int AS accounts FROM "CostUsageEvent" WHERE provider = 'cursor'`)
  const notes = await adb.query(`
    SELECT count(*)::int AS bills,
           count(*) FILTER (WHERE notes ~* 'actual_payment')::int AS actual_payment,
           count(*) FILTER (WHERE notes ~* 'accrued|Billed/accrued')::int AS accrued,
           count(*) FILTER (WHERE notes ~* 'billing period|service period')::int AS mentions_period,
           count(*) FILTER (WHERE notes ~* 'account')::int AS mentions_account,
           count(*) FILTER (WHERE notes ~* 'original USD')::int AS has_usd,
           count(*) FILTER (WHERE "vatAmount" = 0)::int AS zero_vat
    FROM "Expense"
    WHERE date >= '2026-08-13' AND "isArchived" = false
      AND (supplier ILIKE '%cursor%' OR supplier ILIKE '%vercel%' OR supplier ILIKE '%supabase%')`)
  await adb.query('ROLLBACK')
  await adb.end()
  console.log(JSON.stringify({ overlap: overlap.rows[0], missing: missing.rows[0], refs: refs.rows[0], notes: notes.rows[0] }))
}
main()
