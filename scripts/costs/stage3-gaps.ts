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
  const real = new pg.Client({ connectionString: 'postgresql://shadow@127.0.0.1:54329/mpdee_accounts_shadow_real' })
  await real.connect()
  const gaps = await real.query(`
    SELECT e.provider, r.funding, r.quality, count(*)::int AS rows,
           count(*) FILTER (WHERE r."nominalUnits" IS NULL)::int AS missing_nominal,
           count(*) FILTER (WHERE r."providerUnits" IS NULL)::int AS missing_provider
    FROM "CostUsageEvent" e
    JOIN LATERAL (SELECT * FROM "CostUsageRevision" WHERE "eventId" = e.id ORDER BY revision DESC LIMIT 1) r ON true
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3`)
  const fx = await real.query(`SELECT count(*)::int AS rows, count(*) FILTER (WHERE r."fxGbp" IS NOT NULL)::int AS with_fx FROM "CostUsageEvent" e JOIN LATERAL (SELECT * FROM "CostUsageRevision" WHERE "eventId" = e.id ORDER BY revision DESC LIMIT 1) r ON true`)
  const snapshots = await real.query(`SELECT count(*)::int AS rows FROM "CostChargeSnapshot"`)
  await real.end()

  const itrader = env('D:/Websites/iommarket/.env.production')
  const url = new URL(itrader.POSTGRES_URL_NON_POOLING)
  url.searchParams.delete('sslmode')
  url.searchParams.delete('ssl')
  const writer = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } })
  await writer.connect()
  await writer.query('BEGIN READ ONLY')
  const never = await writer.query(`
    WITH charged AS (
      SELECT DISTINCT s."bucketKey" FROM "CostSourceSnapshot" s
      JOIN "CostEntry" e ON e."sourceSnapshotId" = s.id AND e.kind = 'CHARGE'
      WHERE s."sourceKind" = 'VERCEL_FOCUS'
    )
    SELECT count(*)::int AS snapshot_rows_without_charge,
           count(DISTINCT s."bucketKey") FILTER (WHERE NOT EXISTS (SELECT 1 FROM charged c WHERE c."bucketKey" = s."bucketKey"))::int AS buckets_never_charged,
           count(*) FILTER (WHERE s.quarantined)::int AS quarantined_rows
    FROM "CostSourceSnapshot" s
    WHERE s."sourceKind" = 'VERCEL_FOCUS'
      AND NOT EXISTS (SELECT 1 FROM "CostEntry" e WHERE e."sourceSnapshotId" = s.id AND e.kind = 'CHARGE')`)
  const kinds = await writer.query(`
    SELECT e.kind::text AS kind, count(*)::int AS rows
    FROM "CostEntry" e
    JOIN "CostSourceSnapshot" s ON s.id = e."sourceSnapshotId"
    WHERE s."sourceKind" = 'VERCEL_FOCUS'
    GROUP BY 1 ORDER BY 2 DESC`)
  await writer.query('ROLLBACK')
  await writer.end()
  console.log(JSON.stringify({ gaps: gaps.rows, fx: fx.rows[0], snapshots: snapshots.rows[0], never: never.rows[0], kinds: kinds.rows }))
}
main()
