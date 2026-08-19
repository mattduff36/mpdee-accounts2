# Prisma migrations

This app uses Prisma Migrate against PostgreSQL. `npm run db:push` is **forbidden** once migrations exist. Never print `DATABASE_URL`.

Baseline migration name: `20260819160000_init`. After it is applied or resolved in any environment, do not rewrite that directory or SQL.

## Empty database

```bash
npm run db:migrate:deploy
```

Then seed if needed: `npm run db:seed`.

## Database already created with `db push`

1. Snapshot the database.
2. Confirm zero drift. Hosted databases need the remote override:

```bash
npm run db:drift-check -- --allow-remote-db
```

Local Postgres can omit the flag. The command must exit 0.
3. Record the baseline as already applied **without** running its SQL:

```bash
npx prisma migrate resolve --applied 20260819160000_init
```

4. Later schema changes use new migrations and `npm run db:migrate:deploy` (or a production Vercel build).

If `db:drift-check` fails, **do not** treat that as a pending Prisma migration. Read **Leftover snake_case tables** below before dropping anything or re-applying `20260819160000_init`.

## Leftover snake_case tables (known, do not auto-drop)

The hosted production database already has the current Prisma tables (`Client`, `Invoice`, `InvoiceItem`, `Expense`, and the rest of `prisma/schema.prisma`). Baseline `20260819160000_init` is **marked applied**. `prisma migrate status` is up to date. `migrate deploy` will not drop or migrate the leftovers.

It also still contains unused **pre-cutover** tables and enums from an older snake_case schema. Observed 2026-08-19:

- Tables: `clients`, `invoices`, `invoice_items`, `expenses`, `bank_statement_imports`, `bank_transactions`
- Enums: `BusinessArea`, `InvoiceStatus`, `TransactionStatus`

Those leftover tables held real cutover-era rows (`clients` 10, `invoices` 78, `invoice_items` 227, `expenses` 70). The app uses the PascalCase tables only. Counts on the new tables were equal or slightly higher.

**If `npm run db:drift-check` fails against this database**, that is expected. Prisma wants to `DROP` the snake_case objects to match the schema. That is not a queued migration and must not be applied as a surprise.

**Do**

- Keep using PascalCase Prisma models. Do not add `@@map` back to snake_case.
- Leave the leftovers in place until someone explicitly asks for a snapshot-then-drop CRITICAL migration.
- Treat live-DB tests that require zero drift (`MIG-003`, `ACCOUNTS_LIVE_DB_TESTS=1` against this host) as **known fail** on production. Run those tests on empty/disposable Postgres instead.

**Do not**

- Run `DROP TABLE` / `DROP TYPE` because a test or drift-check failed.
- Re-run `prisma migrate deploy` for `20260819160000_init` (those CREATE TABLE statements would fail; tables already exist).
- Re-run `prisma migrate resolve --applied 20260819160000_init`.
- “Fix” drift by deleting leftover accounting data.

When an explicit drop is approved: snapshot (Neon backup or `pg_dump` of the leftover tables), then a new expand-only-forbidden **drop** migration, reviewed as CRITICAL. Do not edit `20260819160000_init`.

## Local development

- New schema: edit `prisma/schema.prisma`, then `npm run db:migrate` (`prisma migrate dev`).
- Default to expand-only SQL. Rename or drop is a separate CRITICAL change.
- `npm run build` does **not** apply migrations.

## Production (Vercel)

- Generic `npm run build` is mutation-free (`prisma generate && next build`).
- Vercel uses `npm run build:vercel` ([vercel.json](../vercel.json)).
- Migrations run **only** when `VERCEL_ENV=production`. Preview and development builds skip migrate even if `ALLOW_PRODUCTION_MIGRATE` is set. That override is for non-Vercel local use only and still refuses non-local hosts.
- Production migrate prefers `DIRECT_URL` or `DATABASE_URL_UNPOOLED` if set. Otherwise it strips a Neon `-pooler` hostname from `DATABASE_URL` so `prisma migrate deploy` uses a direct session (advisory locks fail on the pooler).
- If migrate still times out on `pg_advisory_lock` (`P1002`), the production build retries once. Serialize production deploys when two builds would overlap.

Explicit apply (you must request it): `npm run db:migrate:deploy`.

`/finalise` and `/fap` never run `migrate deploy`, `migrate dev`, or `db push`.

## Rollback

- Fresh empty database: drop/recreate the database and deploy again.
- db-push adoption: `resolve --applied` only changes migration metadata; keep the snapshot.
- Migration applied but app deploy failed: leave the migration applied; roll back application code. Do not delete migration history.
- Contracting schema requires a later migration after old code is retired.

## Live database acceptance (not required for every finalise)

These need a disposable Postgres and are not run in the default `npm test` suite:

- MIG-002: `migrate deploy` on an empty database, then zero drift.
- MIG-003: snapshot a db-push database, confirm drift-check is clean, `migrate resolve --applied 20260819160000_init`, deploy is a no-op, data unchanged.
- MIG-004: a drifted database must fail drift-check; do not resolve.
- ROLL-001: after an expand migration, previous application code still runs.

Set `ACCOUNTS_LIVE_DB_TESTS=1` against **empty/disposable** local Postgres to opt in. Do not point that suite at hosted production: leftover snake_case tables make zero-drift checks fail on purpose (see above).

## First `/fap`

Confirm `git remote get-url origin` and the current branch before the first real push. Vercel MCP is optional (authenticate only to inspect Vercel from chat). Git push remains the default deploy.

## Unresolved in this pass

- **ROLL-001** — A live schema-ahead / application-rollback rehearsal against a real database was not run here. Treat that as an operational step before the first production migrate.
- **MIG-002 / MIG-003 / MIG-004** — Empty-DB deploy, db-push adoption, and drifted-DB refusal need a disposable Postgres instance. Use `npm run db:drift-check` before any `migrate resolve --applied`.
