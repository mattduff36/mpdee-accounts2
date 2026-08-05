import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

function parseEnvLine(line: string): [string, string] | null {
  const trimmedLine = line.trim()
  if (!trimmedLine || trimmedLine.startsWith("#")) return null

  const equalsIndex = trimmedLine.indexOf("=")
  if (equalsIndex === -1) return null

  const key = trimmedLine.slice(0, equalsIndex).trim()
  let value = trimmedLine.slice(equalsIndex + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)

  return [key, value]
}

export function loadLocalEnv(cwd = process.cwd()) {
  for (const fileName of [".env", ".env.local"]) {
    const envPath = resolve(cwd, fileName)
    if (!existsSync(envPath)) continue

    const lines = readFileSync(envPath, "utf8").split(/\r?\n/)
    for (const line of lines) {
      const parsedLine = parseEnvLine(line)
      if (!parsedLine) continue

      const [key, value] = parsedLine
      process.env[key] = value
    }
  }
}
