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

test("DEPLOY-001: production invokes prisma migrate deploy exactly once; preview does not spawn", () => {
  const calls: { args: readonly string[]; envUrl: string | undefined }[] = []
  const spawn: SpawnFn = (_command, args, options) => {
    calls.push({ args, envUrl: options.env?.DATABASE_URL })
    return { status: 0, stdout: "", stderr: "" }
  }

  const preview = runProductionMigrateDeploy(
    {
      ...process.env,
      VERCEL_ENV: "preview",
      ALLOW_PRODUCTION_MIGRATE: "1",
      DATABASE_URL: "postgresql://user:secret@localhost:5432/app",
    },
    spawn
  )
  assert.equal(preview.action, "skip")
  assert.equal(preview.spawnCount, 0)
  assert.equal(calls.length, 0)

  const production = runProductionMigrateDeploy(
    {
      ...process.env,
      VERCEL_ENV: "production",
      DATABASE_URL: "postgresql://user:secret@localhost:5432/app",
    },
    spawn
  )
  assert.equal(production.action, "migrate")
  assert.equal(production.spawnCount, 1)
  assert.equal(calls.length, 1)
  assert.deepEqual([...calls[0]!.args], [...PRISMA_MIGRATE_DEPLOY_ARGS])
  assert.equal(calls[0]!.args.some((arg) => arg.includes("://")), false)
  assert.equal(calls[0]!.envUrl, "postgresql://user:secret@localhost:5432/app")
})
