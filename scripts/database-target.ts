export type DatabaseTargetIdentity = {
  host: string
  database: string
  port: string | null
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])

export function isLocalDatabaseHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  if (LOCAL_HOSTS.has(normalized)) return true
  return normalized.endsWith(".localhost")
}

export function parseDatabaseTargetIdentity(url: string): DatabaseTargetIdentity | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return null
    }
    const host = decodeURIComponent(parsed.hostname)
    if (!host) return null
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, "").split("/")[0] ?? "")
    if (!database) return null
    const port = parsed.port || null
    return { host, database, port }
  } catch {
    return null
  }
}

export function formatDatabaseTargetIdentity(identity: DatabaseTargetIdentity): string {
  const port = identity.port ? `:${identity.port}` : ""
  return `${identity.host}${port}/${identity.database}`
}

export function sanitizeDatabaseOutput(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "[redacted]")
}

export function interpretMigrateDiffExit(status: number | null): "clean" | "drift" | "error" {
  if (status === 0) return "clean"
  if (status === 2) return "drift"
  return "error"
}

export function assertSafeDatabaseUrl(
  url: string | undefined,
  options: { allowRemote: boolean }
): DatabaseTargetIdentity {
  if (!url) {
    throw new Error("DATABASE_URL is missing")
  }
  const identity = parseDatabaseTargetIdentity(url)
  if (!identity) {
    throw new Error("DATABASE_URL is malformed")
  }
  if (!options.allowRemote && !isLocalDatabaseHost(identity.host)) {
    throw new Error(
      `Refusing non-local database host ${identity.host}. Pass --allow-remote-db only when you intend to use this host.`
    )
  }
  return identity
}
