import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DRIFT_DIFF_ARGS } from "./drift-check"
import {
  decideProductionMigrate,
  PRISMA_MIGRATE_DEPLOY_ARGS,
  runProductionMigrateDeploy,
  type SpawnFn,
} from "./migrate-deploy-production"

test("DEPLOY-001: production migrates; preview and development skip", () => {
  assert.equal(decideProductionMigrate({ vercelEnv: "production", allowProductionMigrate: false }).action, "migrate")
  assert.equal(decideProductionMigrate({ vercelEnv: "preview", allowProductionMigrate: false }).action, "skip")
  assert.equal(decideProductionMigrate({ vercelEnv: "development", allowProductionMigrate: false }).action, "skip")
})

test("DEPLOY-001: preview and development ignore ALLOW_PRODUCTION_MIGRATE", () => {
  assert.equal(decideProductionMigrate({ vercelEnv: "preview", allowProductionMigrate: true }).action, "skip")
  assert.equal(decideProductionMigrate({ vercelEnv: "development", allowProductionMigrate: true }).action, "skip")
})

test("DEPLOY-001: unknown local context refuses migrate unless explicitly allowed", () => {
  assert.equal(decideProductionMigrate({ vercelEnv: undefined, allowProductionMigrate: false }).action, "refuse")
  assert.equal(decideProductionMigrate({ vercelEnv: undefined, allowProductionMigrate: true }).action, "migrate")
})

test("DEPLOY-001: Vercel production buildCommand is build:vercel; drift argv has no URL", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { buildCommand: string }
  assert.equal(vercel.buildCommand, "npm run build:vercel")
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }
  assert.match(pkg.scripts["build:vercel"], /migrate-deploy-production/)
  assert.equal(pkg.scripts.build.includes("migrate-deploy-production"), false)
  assert.equal((DRIFT_DIFF_ARGS as readonly string[]).includes("--from-url"), false)
  assert.equal((DRIFT_DIFF_ARGS as readonly string[]).includes("--exit-code"), true)
  assert.equal(DRIFT_DIFF_ARGS.some((arg) => arg.includes("://")), false)
})

function testEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DIRECT_URL: "",
    DATABASE_URL_UNPOOLED: "",
    ...overrides,
  }
}

test("DEPLOY-001: production invokes prisma migrate deploy exactly once; preview does not spawn", () => {
  const calls: { args: readonly string[]; envUrl: string | undefined }[] = []
  const spawn: SpawnFn = (_command, args, options) => {
    calls.push({ args, envUrl: options.env?.DATABASE_URL })
    return { status: 0, stdout: "", stderr: "" }
  }

  const preview = runProductionMigrateDeploy(
    testEnv({
      VERCEL_ENV: "preview",
      ALLOW_PRODUCTION_MIGRATE: "1",
      DATABASE_URL: "postgresql://user:secret@localhost:5432/app",
    }),
    spawn
  )
  assert.equal(preview.action, "skip")
  assert.equal(preview.spawnCount, 0)
  assert.equal(calls.length, 0)

  const production = runProductionMigrateDeploy(
    testEnv({
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://user:secret@localhost:5432/app",
      PRISMA_MIGRATE_LOCK_RETRY_MS: "0",
    }),
    spawn
  )
  assert.equal(production.action, "migrate")
  assert.equal(production.spawnCount, 1)
  assert.equal(calls.length, 1)
  assert.deepEqual([...calls[0]!.args], [...PRISMA_MIGRATE_DEPLOY_ARGS])
  assert.equal(calls[0]!.args.some((arg) => arg.includes("://")), false)
  assert.equal(calls[0]!.envUrl, "postgresql://user:secret@localhost:5432/app")
})

test("DEPLOY-002: production migrate uses unpooled Neon host and retries advisory lock timeout", () => {
  const calls: string[] = []
  let attempt = 0
  const spawn: SpawnFn = (_command, _args, options) => {
    calls.push(options.env?.DATABASE_URL ?? "")
    attempt += 1
    if (attempt === 1) {
      return { status: 1, stdout: "", stderr: "Error: P1002 Timed out trying to acquire a postgres advisory lock" }
    }
    return { status: 0, stdout: "", stderr: "" }
  }

  const result = runProductionMigrateDeploy(
    testEnv({
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://user:secret@ep-example-pooler.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require",
      PRISMA_MIGRATE_LOCK_RETRY_MS: "0",
    }),
    spawn,
  )
  assert.equal(result.action, "migrate")
  assert.equal(result.spawnCount, 2)
  assert.equal(calls.length, 2)
  assert.equal(calls[0], "postgresql://user:secret@ep-example.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require")
  assert.equal(calls[0]?.includes("-pooler"), false)
})
