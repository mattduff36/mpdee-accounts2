import assert from "node:assert/strict"
import { test } from "node:test"
import {
  assertSafeDatabaseUrl,
  formatDatabaseTargetIdentity,
  interpretMigrateDiffExit,
  isLocalDatabaseHost,
  isMigrateAdvisoryLockTimeout,
  neonUnpooledHostname,
  parseDatabaseTargetIdentity,
  resolveMigrateDatabaseUrl,
  sanitizeDatabaseOutput,
} from "./database-target"

test("GUARD-001: localhost and 127.0.0.1 are local hosts", () => {
  assert.equal(isLocalDatabaseHost("localhost"), true)
  assert.equal(isLocalDatabaseHost("127.0.0.1"), true)
  assert.equal(isLocalDatabaseHost("::1"), true)
  assert.equal(isLocalDatabaseHost("db.example.com"), false)
})

test("GUARD-001: parses host and database without returning the URL", () => {
  const identity = parseDatabaseTargetIdentity(
    "postgresql://user:secret@localhost:5432/mpdee_accounts2?sslmode=require"
  )
  assert.deepEqual(identity, { host: "localhost", database: "mpdee_accounts2", port: "5432" })
  assert.equal(formatDatabaseTargetIdentity(identity!), "localhost:5432/mpdee_accounts2")
  assert.equal(JSON.stringify(identity).includes("secret"), false)
})

test("GUARD-001: missing, malformed, and remote URLs are refused", () => {
  assert.throws(() => assertSafeDatabaseUrl(undefined, { allowRemote: false }), /missing/)
  assert.throws(() => assertSafeDatabaseUrl("not-a-url", { allowRemote: false }), /malformed/)
  assert.throws(
    () =>
      assertSafeDatabaseUrl("postgresql://user:secret@db.example.com:5432/app", {
        allowRemote: false,
      }),
    /non-local/
  )
  const identity = assertSafeDatabaseUrl("postgresql://user:secret@db.example.com:5432/app", {
    allowRemote: true,
  })
  assert.equal(identity.host, "db.example.com")
})

test("GUARD-001: sanitizes connection strings in process output", () => {
  const leaked = "error postgresql://user:secret@db.example.com:5432/app boom"
  const sanitized = sanitizeDatabaseOutput(leaked)
  assert.equal(sanitized.includes("secret"), false)
  assert.equal(sanitized.includes("postgresql://"), false)
  assert.equal(sanitized.includes("[redacted]"), true)
})

test("DEPLOY-002: Neon pooler host is rewritten for migrate; DIRECT_URL wins", () => {
  assert.equal(
    neonUnpooledHostname("ep-example-pooler.c-2.eu-west-2.aws.neon.tech"),
    "ep-example.c-2.eu-west-2.aws.neon.tech",
  )
  const fromPooler = resolveMigrateDatabaseUrl({
    DATABASE_URL: "postgresql://user:secret@ep-example-pooler.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require&pgbouncer=true",
  })
  assert.equal(fromPooler?.includes("-pooler"), false)
  assert.equal(fromPooler?.includes("pgbouncer"), false)
  assert.equal(fromPooler?.includes("secret"), true)
  assert.equal(
    resolveMigrateDatabaseUrl({
      DIRECT_URL: "postgresql://user:secret@ep-example.eu-west-2.aws.neon.tech/neondb",
      DATABASE_URL: "postgresql://user:secret@ep-example-pooler.c-2.eu-west-2.aws.neon.tech/neondb",
    }),
    "postgresql://user:secret@ep-example.eu-west-2.aws.neon.tech/neondb",
  )
  assert.equal(isMigrateAdvisoryLockTimeout("Error: P1002\nTimed out trying to acquire a postgres advisory lock"), true)
  assert.equal(isMigrateAdvisoryLockTimeout("Migration applied"), false)
})

test("MIG-004: migrate diff exit 2 is drift and must not be adopted", () => {
  assert.equal(interpretMigrateDiffExit(0), "clean")
  assert.equal(interpretMigrateDiffExit(2), "drift")
  assert.equal(interpretMigrateDiffExit(1), "error")
})
