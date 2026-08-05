import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Client as PgClient } from "pg"
import { loadLocalEnv } from "./load-env"

loadLocalEnv()

const LEGACY_TABLES = ["clients", "invoices", "invoice_items", "expenses", "bank_statement_imports", "bank_transactions"] as const

async function main() {
  const connectionString = process.env.LEGACY_DATABASE_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error("LEGACY_DATABASE_URL is required to create the backup")

  const client = new PgClient({ connectionString })
  await client.connect()
  await client.query("SET default_transaction_read_only = on")

  try {
    const columns = await client.query(
      `
        select table_name, column_name, data_type, is_nullable
        from information_schema.columns
        where table_schema = 'public'
          and table_name = any($1::text[])
        order by table_name, ordinal_position
      `,
      [LEGACY_TABLES],
    )

    const rows: Record<string, unknown[]> = {}
    for (const tableName of LEGACY_TABLES) {
      const result = await client.query(`select * from ${tableName}`)
      rows[tableName] = result.rows
    }

    mkdirSync("backups", { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const outputPath = join("backups", `legacy-db-backup-${timestamp}.json`)
    writeFileSync(
      outputPath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          source: "mpdee-accounts legacy database",
          tables: LEGACY_TABLES,
          columns: columns.rows,
          rows,
        },
        null,
        2,
      ),
    )

    console.log(`Wrote legacy backup to ${outputPath}`)
    for (const tableName of LEGACY_TABLES) console.log(`${tableName}: ${rows[tableName].length} rows`)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
