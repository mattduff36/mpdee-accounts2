import assert from "node:assert/strict"
import { test } from "node:test"
import {
  assertNoSecrets,
  assertNotMixed,
  buildContainsMigration,
  isSecretPath,
  parseFinaliseArgs,
  porcelainPath,
  summarizeCommitMessage,
} from "./finalise-guards"

test("parseFinaliseArgs maps push, dry-run, and overrides", () => {
  assert.deepEqual(parseFinaliseArgs(["--push", "--dry-run", "--allow-remote-db", "--allow-mixed"]), {
    push: true,
    dryRun: true,
    allowRemoteDb: true,
    allowMixed: true,
  })
})

test("porcelainPath reads renamed paths", () => {
  assert.equal(porcelainPath(" M src/lib/auth.ts"), "src/lib/auth.ts")
  assert.equal(porcelainPath("R  old.ts -> new.ts"), "new.ts")
})

test("secret-like paths include .env but not .env.example", () => {
  assert.equal(isSecretPath(".env"), true)
  assert.equal(isSecretPath(".env.local"), true)
  assert.equal(isSecretPath(".env.example"), false)
  assert.throws(() => assertNoSecrets([".env"]), /secret-like/)
})

test("mixed hygiene and app feature paths are refused", () => {
  assert.throws(
    () => assertNotMixed([".cursor/rules/accounts-core.mdc", "src/lib/auth.ts"], false),
    /mixed hygiene/
  )
  assert.throws(
    () => assertNotMixed(["AGENTS.md", "middleware.ts"], false),
    /mixed hygiene/
  )
  assert.doesNotThrow(() =>
    assertNotMixed([".cursor/rules/accounts-core.mdc", "src/lib/auth.ts"], true)
  )
  assert.doesNotThrow(() =>
    assertNotMixed([".cursor/rules/accounts-core.mdc", "prisma/schema.prisma", "scripts/finalise.ts"], false)
  )
})

test("BUILD-001 helper detects migrate in a build script", () => {
  assert.equal(buildContainsMigration("prisma generate && next build"), false)
  assert.equal(buildContainsMigration("prisma generate && prisma migrate deploy && next build"), true)
  assert.equal(buildContainsMigration("prisma db push && next build"), true)
})

test("commit message summarises mixed migration and rules work", () => {
  assert.equal(
    summarizeCommitMessage([".cursor/rules/accounts-core.mdc", "prisma/migrations/20260819160000_init/migration.sql"]),
    "chore: add accounts migrations, finalise, and agent rules"
  )
})
