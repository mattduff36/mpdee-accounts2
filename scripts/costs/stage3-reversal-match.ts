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
  const match = await db.query(`
    WITH amounts AS (
      SELECT s."bucketKey", s.revision, s.classified, s.quarantined,
        coalesce(sum(e."nativeAmount") FILTER (WHERE e.kind = 'CHARGE'), 0) AS charge,
        coalesce(sum(e."nativeAmount") FILTER (WHERE e.kind = 'REVERSAL'), 0) AS reversal
      FROM "CostSourceSnapshot" s
      LEFT JOIN "CostEntry" e ON e."sourceSnapshotId" = s.id
      WHERE s."sourceKind" = 'VERCEL_FOCUS'
      GROUP BY s.id
    )
    SELECT
      count(*) FILTER (WHERE a.reversal <> 0)::int AS revisions_with_reversal,
      count(*) FILTER (WHERE a.reversal <> 0 AND p.charge IS NULL)::int AS reversal_without_prior,
      count(*) FILTER (WHERE a.reversal <> 0 AND p.charge IS NOT NULL AND a.reversal = p.charge)::int AS reversal_equals_prior_charge,
      count(*) FILTER (WHERE a.reversal <> 0 AND p.charge IS NOT NULL AND a.reversal <> p.charge)::int AS reversal_differs_from_prior
    FROM amounts a
    LEFT JOIN amounts p ON p."bucketKey" = a."bucketKey" AND p.revision = a.revision - 1`)
  await db.query('ROLLBACK')
  await db.end()
  console.log(JSON.stringify(match.rows[0]))
}
main()
