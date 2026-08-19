import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { getEffectiveDatabaseUrl, loadLocalEnv } from "./load-env"
import {
  assertSafeDatabaseUrl,
  formatDatabaseTargetIdentity,
  sanitizeDatabaseOutput,
} from "./database-target"
import {
  assertNoSecrets,
  assertNotMixed,
  buildContainsMigration,
  parseFinaliseArgs,
  porcelainPath,
  summarizeCommitMessage,
  type FinaliseOptions,
} from "./finalise-guards"
import { TRUSTED_OPERATIONAL_ACTIONS } from "./trusted-operational-actions"

function git(args: string[], options: { encoding?: "utf8" } = {}): {
  status: number | null
  stdout: string
  stderr: string
} {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

function npmRun(script: string): void {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  const result = spawnSync(npm, ["run", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, CI: "1" },
  })
  const output = sanitizeDatabaseOutput(`${result.stdout ?? ""}${result.stderr ?? ""}`)
  if (output.trim()) console.log(output.trim())
  if (result.status !== 0) {
    throw new Error(`npm run ${script} failed`)
  }
}

function changedPaths(): string[] {
  const result = git(["status", "--porcelain"])
  if (result.status !== 0) {
    throw new Error(result.stderr || "git status failed")
  }
  return result.stdout
    .split(/\r?\n/)
    .map(porcelainPath)
    .filter((path): path is string => Boolean(path))
}

function currentBranch(): string {
  const result = git(["rev-parse", "--abbrev-ref", "HEAD"])
  if (result.status !== 0) throw new Error("Could not determine current branch")
  return result.stdout.trim()
}

function hasOrigin(): boolean {
  const result = git(["remote"])
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).includes("origin")
}

function assertBuildDoesNotMigrate(): void {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, string>
  }
  if (buildContainsMigration(pkg.scripts?.build ?? "")) {
    throw new Error("npm run build must not apply migrations")
  }
}

function printPlan(options: FinaliseOptions, branch: string, paths: string[]): void {
  console.log(`Mode: ${options.push ? "finalise + push" : "finalise"} (${TRUSTED_OPERATIONAL_ACTIONS[options.push ? "fap" : "finalise"].safetyContract})`)
  console.log(`Branch: ${branch}`)
  console.log(`Changed files: ${paths.length}`)
  if (paths.length > 0) {
    console.log(`Commit message: ${summarizeCommitMessage(paths)}`)
  }
  console.log("Checks: typecheck, test, build")
  console.log(`Push: ${options.push ? "current branch to origin" : "skipped"}`)
  console.log("Database: finalise does not apply schema changes")
}

export function runFinalise(argv = process.argv.slice(2)): void {
  const options = parseFinaliseArgs(argv)
  loadLocalEnv()
  const branch = currentBranch()
  const paths = changedPaths()

  assertBuildDoesNotMigrate()
  assertNoSecrets(paths)
  assertNotMixed(paths, options.allowMixed)

  const databaseUrl = getEffectiveDatabaseUrl()
  if (databaseUrl) {
    const identity = assertSafeDatabaseUrl(databaseUrl, {
      allowRemote: options.allowRemoteDb,
    })
    console.log(`Database target: ${formatDatabaseTargetIdentity(identity)}`)
  } else {
    console.log("Database target: not set")
  }

  if (options.push && !hasOrigin()) {
    throw new Error("No git remote named origin. Confirm origin before /fap.")
  }

  printPlan(options, branch, paths)

  if (options.dryRun) {
    console.log("Dry run: no checks, commit, or push were executed.")
    return
  }

  npmRun("typecheck")
  npmRun("test")
  npmRun("build")

  if (paths.length === 0) {
    console.log("No workspace changes to commit.")
  } else {
    const message = summarizeCommitMessage(paths)
    const add = git(["add", "--", ...paths])
    if (add.status !== 0) throw new Error(add.stderr || "git add failed")
    const commit = git(["commit", "-m", message])
    if (commit.status !== 0) throw new Error(commit.stderr || "git commit failed")
    console.log(`Created commit: ${message}`)
  }

  if (options.push) {
    const push = git(["push", "-u", "origin", "HEAD"])
    if (push.status !== 0) throw new Error(push.stderr || "git push failed")
    console.log(`Pushed ${branch}.`)
  }

  console.log("Finalise complete.")
}

const invokedDirectly = /\/finalise\.ts$/.test((process.argv[1] ?? "").replace(/\\/g, "/"))
if (invokedDirectly) {
  try {
    runFinalise()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
