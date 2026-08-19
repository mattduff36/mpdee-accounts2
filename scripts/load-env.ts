import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

function parseEnvLine(line: string): [string, string] | null {
  const trimmedLine = line.trim()
  if (!trimmedLine || trimmedLine.startsWith("#")) return null

  const equalsIndex = trimmedLine.indexOf("=")
  if (equalsIndex === -1) return null

  const key = trimmedLine.slice(0, equalsIndex).trim()
  let value = trimmedLine.slice(equalsIndex + 1).trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }

  return [key, value]
}

export function readFileEnvMap(cwd = process.cwd()): Record<string, string> {
  const fromFiles: Record<string, string> = {}
  for (const fileName of [".env", ".env.local"]) {
    const envPath = resolve(cwd, fileName)
    if (!existsSync(envPath)) continue

    const lines = readFileSync(envPath, "utf8").split(/\r?\n/)
    for (const line of lines) {
      const parsedLine = parseEnvLine(line)
      if (!parsedLine) continue
      const [key, value] = parsedLine
      fromFiles[key] = value
    }
  }
  return fromFiles
}

/**
 * Load `.env` then `.env.local` (local wins among files).
 * Already-set process.env keys (shell / Vercel) are not overwritten.
 */
export function loadLocalEnv(cwd = process.cwd()): Record<string, string> {
  const fromFiles = readFileEnvMap(cwd)
  for (const [key, value] of Object.entries(fromFiles)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
  return fromFiles
}

export function getEffectiveEnvValue(key: string, cwd = process.cwd()): string | undefined {
  if (process.env[key] !== undefined) return process.env[key]
  return readFileEnvMap(cwd)[key]
}

export function getEffectiveDatabaseUrl(cwd = process.cwd()): string | undefined {
  const value = getEffectiveEnvValue("DATABASE_URL", cwd)
  return value && value.length > 0 ? value : undefined
}

export function prismaCliEnv(url: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, DATABASE_URL: url, CI: "1" }
}
