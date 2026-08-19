export type FinaliseOptions = {
  push: boolean
  dryRun: boolean
  allowRemoteDb: boolean
  allowMixed: boolean
}

export function parseFinaliseArgs(argv: string[]): FinaliseOptions {
  const args = new Set(argv)
  return {
    push: args.has("--push"),
    dryRun: args.has("--dry-run"),
    allowRemoteDb: args.has("--allow-remote-db"),
    allowMixed: args.has("--allow-mixed"),
  }
}

export function porcelainPath(line: string): string | null {
  if (!line || line.length < 4) return null
  const rest = line.slice(3)
  const renamed = rest.split(" -> ")
  return renamed[renamed.length - 1] ?? null
}

export function isSecretPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/")
  const base = normalized.split("/").pop() ?? normalized
  if (base === ".env.example") return false
  if (base === ".env" || base.startsWith(".env.")) return true
  if (/\.(pem|p12|key)$/i.test(base)) return true
  if (/credentials\.json$/i.test(base)) return true
  return false
}

export function isHygienePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/")
  return (
    normalized.startsWith(".cursor/") ||
    normalized === "AGENTS.md" ||
    normalized.startsWith("docs/") ||
    normalized === "README.md" ||
    normalized === "SETUP.md"
  )
}

export function isAppFeaturePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/")
  return normalized.startsWith("src/") || normalized === "middleware.ts"
}

export function isMixedHygieneAndApp(paths: string[]): boolean {
  return paths.some(isHygienePath) && paths.some(isAppFeaturePath)
}

export function summarizeCommitMessage(paths: string[]): string {
  const areas = new Set<string>()
  for (const filePath of paths) {
    const normalized = filePath.replace(/\\/g, "/")
    if (normalized.startsWith(".cursor/") || normalized === "AGENTS.md") areas.add("agent-rules")
    else if (normalized.startsWith("prisma/")) areas.add("prisma")
    else if (normalized.startsWith("scripts/")) areas.add("scripts")
    else if (normalized.startsWith("docs/") || normalized === "README.md" || normalized === "SETUP.md") {
      areas.add("docs")
    } else if (normalized.startsWith("src/")) areas.add("app")
    else areas.add("chore")
  }
  if (areas.has("agent-rules") && areas.has("prisma")) {
    return "chore: add accounts migrations, finalise, and agent rules"
  }
  if (areas.has("agent-rules")) return "chore: add accounts agent rules"
  if (areas.has("prisma")) return "chore: add prisma migrations"
  if (areas.has("scripts")) return "chore: add accounts finalise scripts"
  if (areas.has("docs")) return "docs: update accounts setup and migration notes"
  return "chore: update accounts app"
}

export function assertNoSecrets(paths: string[]): void {
  const secrets = paths.filter(isSecretPath)
  if (secrets.length > 0) {
    throw new Error(`Refusing to finalise with secret-like paths: ${secrets.join(", ")}`)
  }
}

export function assertNotMixed(paths: string[], allowMixed: boolean): void {
  if (!allowMixed && isMixedHygieneAndApp(paths)) {
    throw new Error(
      "Refusing mixed hygiene (.cursor/docs) and application (src/** or middleware.ts) changes. Pass --allow-mixed only if that mix is intentional."
    )
  }
}

export function buildContainsMigration(script: string): boolean {
  return /migrate\s+deploy|db:migrate:deploy|db push|db:push/i.test(script)
}
