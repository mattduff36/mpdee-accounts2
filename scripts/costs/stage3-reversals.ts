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
  const url = new URL(itrader.POSTGRES_URL_NON_POOLING)
  url.searchParams.delete('sslmode')
  url.searchParams.delete('ssl')
  const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } })
  await db.connect()
  await db.query('BEGIN READ ONLY')
  const placement = await db.query(`
    WITH latest AS (
      SELECT DISTINCT ON (s."bucketKey") s.id, s.classified, s.quarantined
      FROM "CostSourceSnapshot" s
      WHERE s."sourceKind" = 'VERCEL_FOCUS'
      ORDER BY s."bucketKey", s.revision DESC
    )
    SELECT
      count(*) FILTER (WHERE e.kind = 'REVERSAL' AND l.id IS NOT NULL AND l.classified AND NOT l.quarantined)::int AS reversals_on_latest_classified,
      count(*) FILTER (WHERE e.kind = 'REVERSAL' AND l.id IS NULL)::int AS reversals_on_older_revisions,
      count(*) FILTER (WHERE e.kind = 'REVERSAL' AND l.id IS NOT NULL AND (NOT l.classified OR l.quarantined))::int AS reversals_on_latest_excluded,
      coalesce(sum(e."nativeAmount") FILTER (WHERE e.kind = 'REVERSAL' AND l.id IS NOT NULL AND l.classified AND NOT l.quarantined), 0)::text AS latest_reversal_amount,
      coalesce(sum(e."nativeAmount") FILTER (WHERE e.kind = 'CHARGE' AND l.id IS NOT NULL AND l.classified AND NOT l.quarantined), 0)::text AS latest_charge_amount
    FROM "CostEntry" e
    JOIN "CostSourceSnapshot" s ON s.id = e."sourceSnapshotId"
    LEFT JOIN latest l ON l.id = s.id
    WHERE s."sourceKind" = 'VERCEL_FOCUS'`)
  const paired = await db.query(`
    WITH latest AS (
      SELECT DISTINCT ON (s."bucketKey") s.id
      FROM "CostSourceSnapshot" s
      WHERE s."sourceKind" = 'VERCEL_FOCUS' AND s.classified AND NOT s.quarantined
      ORDER BY s."bucketKey", s.revision DESC
    )
    SELECT count(*)::int AS latest_snapshots_with_both
    FROM latest l
    WHERE EXISTS (SELECT 1 FROM "CostEntry" c WHERE c."sourceSnapshotId" = l.id AND c.kind = 'CHARGE')
      AND EXISTS (SELECT 1 FROM "CostEntry" r WHERE r."sourceSnapshotId" = l.id AND r.kind = 'REVERSAL')`)
  await db.query('ROLLBACK')
  await db.end()
  const real = new pg.Client({ connectionString: 'postgresql://shadow@127.0.0.1:54329/mpdee_accounts_shadow_real' })
  await real.connect()
  const unknown = await real.query(`
    SELECT coalesce(r.evidence->>'kind', 'missing') AS kind, count(*)::int AS rows,
           count(*) FILTER (WHERE r."nominalUnits" IS NULL)::int AS missing_nominal
    FROM "CostUsageEvent" e
    JOIN LATERAL (SELECT * FROM "CostUsageRevision" WHERE "eventId" = e.id ORDER BY revision DESC LIMIT 1) r ON true
    WHERE e.provider = 'cursor' AND (r.funding = 'unknown' OR r.quality = 'review')
    GROUP BY 1 ORDER BY 2 DESC`)
  await real.end()
  console.log(JSON.stringify({ placement: placement.rows[0], paired: paired.rows[0], unknown: unknown.rows }))
}
main()
