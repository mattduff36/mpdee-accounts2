import { spawnSync } from "node:child_process"
import { getEffectiveDatabaseUrl, loadLocalEnv, prismaCliEnv } from "./load-env"
import {
  assertSafeDatabaseUrl,
  formatDatabaseTargetIdentity,
  sanitizeDatabaseOutput,
} from "./database-target"

export type ProductionMigrateDecision = {
  action: "migrate" | "skip" | "refuse"
  reason: string
}

export function decideProductionMigrate(input: {
  vercelEnv: string | undefined
  allowProductionMigrate: boolean
}): ProductionMigrateDecision {
  if (input.vercelEnv === "preview" || input.vercelEnv === "development") {
    return { action: "skip", reason: `Skipping migrations: VERCEL_ENV=${input.vercelEnv}` }
  }
  if (input.vercelEnv === "production") {
    return { action: "migrate", reason: "production migrate allowed" }
  }
  if (input.allowProductionMigrate) {
    return { action: "migrate", reason: "explicit ALLOW_PRODUCTION_MIGRATE for non-Vercel context" }
  }
  return {
    action: "refuse",
    reason:
      "Refusing migrate deploy outside VERCEL_ENV=production. Preview builds skip migrate and ignore ALLOW_PRODUCTION_MIGRATE. Local apply uses npm run db:migrate:deploy only when explicitly requested.",
  }
}

function npmCommand(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx"
}

export const PRISMA_MIGRATE_DEPLOY_ARGS = ["prisma", "migrate", "deploy"] as const

export type SpawnResult = {
  status: number | null
  stdout?: string | null
  stderr?: string | null
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; encoding?: string; env?: NodeJS.ProcessEnv; shell?: boolean }
) => SpawnResult

export function runProductionMigrateDeploy(
  env: NodeJS.ProcessEnv = process.env,
  spawn: SpawnFn = spawnSync as unknown as SpawnFn
): { action: "migrate" | "skip"; spawnCount: number } {
  loadLocalEnv()
  const decision = decideProductionMigrate({
    vercelEnv: env.VERCEL_ENV,
    allowProductionMigrate: env.ALLOW_PRODUCTION_MIGRATE === "1",
  })

  if (decision.action === "skip") {
    console.log(decision.reason)
    return { action: "skip", spawnCount: 0 }
  }
  if (decision.action === "refuse") {
    throw new Error(decision.reason)
  }

  const url = env.DATABASE_URL || getEffectiveDatabaseUrl()
  const identity = assertSafeDatabaseUrl(url, {
    allowRemote: env.VERCEL_ENV === "production",
  })
  console.log(`Migrating database ${formatDatabaseTargetIdentity(identity)}`)

  const result = spawn(npmCommand(), PRISMA_MIGRATE_DEPLOY_ARGS, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: prismaCliEnv(url as string, env),
    shell: process.platform === "win32",
  })
  const output = sanitizeDatabaseOutput(`${result.stdout ?? ""}${result.stderr ?? ""}`)
  if (output.trim()) console.log(output.trim())
  if (result.status !== 0) {
    throw new Error("prisma migrate deploy failed")
  }
  return { action: "migrate", spawnCount: 1 }
}

const invokedDirectly = /\/migrate-deploy-production\.ts$/.test(
  (process.argv[1] ?? "").replace(/\\/g, "/")
)
if (invokedDirectly) {
  try {
    runProductionMigrateDeploy()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
