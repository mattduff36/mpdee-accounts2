import { spawnSync } from "node:child_process"
import { getEffectiveDatabaseUrl, loadLocalEnv, prismaCliEnv } from "./load-env"
import {
  assertSafeDatabaseUrl,
  formatDatabaseTargetIdentity,
  interpretMigrateDiffExit,
  sanitizeDatabaseOutput,
} from "./database-target"

function npxCommand(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx"
}

/** Live database is taken from env DATABASE_URL, never from argv. */
export const DRIFT_DIFF_ARGS = [
  "prisma",
  "migrate",
  "diff",
  "--from-schema-datasource",
  "prisma/schema.prisma",
  "--to-schema-datamodel",
  "prisma/schema.prisma",
  "--script",
  "--exit-code",
] as const

export function runDriftCheck(options: { allowRemote?: boolean } = {}): void {
  loadLocalEnv()
  const url = getEffectiveDatabaseUrl()
  const identity = assertSafeDatabaseUrl(url, {
    allowRemote: options.allowRemote === true,
  })
  console.log(`Checking schema drift for ${formatDatabaseTargetIdentity(identity)}`)

  const result = spawnSync(npxCommand(), [...DRIFT_DIFF_ARGS], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: prismaCliEnv(url as string),
    shell: process.platform === "win32",
  })

  const verdict = interpretMigrateDiffExit(result.status)
  if (verdict === "clean") {
    console.log("No schema drift.")
    return
  }
  if (verdict === "drift") {
    throw new Error("Schema drift detected. Do not run migrate resolve --applied.")
  }
  throw new Error(sanitizeDatabaseOutput(result.stderr || "prisma migrate diff failed"))
}

const invokedDirectly = /\/drift-check\.ts$/.test((process.argv[1] ?? "").replace(/\\/g, "/"))
if (invokedDirectly) {
  try {
    runDriftCheck({ allowRemote: process.argv.includes("--allow-remote-db") })
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
