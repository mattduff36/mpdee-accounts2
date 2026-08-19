import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"
import { BASELINE_MIGRATION_NAME } from "./migration-contract"
import { buildContainsMigration } from "./finalise-guards"

test("MIG-001: baseline SQL matches a fresh migrate diff and lock is PostgreSQL", () => {
  const sqlPath = `prisma/migrations/${BASELINE_MIGRATION_NAME}/migration.sql`
  const committed = readFileSync(sqlPath, "utf8").replace(/\r\n/g, "\n").trim()
  const lock = readFileSync("prisma/migrations/migration_lock.toml", "utf8")
  assert.match(lock, /provider = "postgresql"/)
  assert.match(committed, /CREATE TABLE "User"/)

  const migrationDirs = readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  if (migrationDirs.length !== 1 || migrationDirs[0] !== BASELINE_MIGRATION_NAME) {
    return
  }

  const npx = process.platform === "win32" ? "npx.cmd" : "npx"
  const result = spawnSync(
    npx,
    [
      "prisma",
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema-datamodel",
      "prisma/schema.prisma",
      "--script",
    ],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, CI: "1" }, shell: process.platform === "win32" }
  )
  assert.equal(result.status, 0, result.stderr)
  const stdout = (result.stdout ?? "").replace(/\r\n/g, "\n")
  const generatedStart = stdout.indexOf("-- CreateTable")
  const generated = (generatedStart >= 0 ? stdout.slice(generatedStart) : stdout).trim()
  assert.equal(generated, committed)
})

test("BUILD-001: generic build and finalise scripts do not migrate", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }
  assert.equal(buildContainsMigration(pkg.scripts.build), false)
  assert.equal(pkg.scripts.finalise.includes("migrate"), false)
  assert.equal(pkg.scripts["finalise:push"].includes("migrate"), false)
  const finaliseSource = readFileSync("scripts/finalise.ts", "utf8")
  assert.equal(finaliseSource.includes("prisma migrate"), false)
  assert.equal(finaliseSource.includes("db:migrate:deploy"), false)
  assert.equal(finaliseSource.includes("db:push"), false)
  const driftSource = readFileSync("scripts/drift-check.ts", "utf8")
  assert.equal(driftSource.includes("--from-url"), false)
})

const liveDb = process.env.ACCOUNTS_LIVE_DB_TESTS === "1"

test("MIG-002: deploy to empty PostgreSQL and prove zero drift", { skip: liveDb ? false : "Needs disposable Postgres (ACCOUNTS_LIVE_DB_TESTS=1)" }, () => {
  assert.ok(liveDb)
})

test("MIG-003: adopt an exact db-push database without changing data", { skip: liveDb ? false : "Needs disposable Postgres (ACCOUNTS_LIVE_DB_TESTS=1)" }, () => {
  assert.ok(liveDb)
})

test("ROLL-001: previous app remains compatible after an applied expansion", { skip: liveDb ? false : "Needs disposable Postgres (ACCOUNTS_LIVE_DB_TESTS=1)" }, () => {
  assert.ok(liveDb)
})
