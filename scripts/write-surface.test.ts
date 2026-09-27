import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { test } from "node:test"

const ROOT = process.cwd()

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) files.push(...walk(path))
    else files.push(path)
  }
  return files
}

function repoPath(path: string): string {
  return relative(ROOT, path).split(sep).join("/")
}

function serverActionBodies(source: string): string[] {
  const bodies: string[] = []
  const pattern = /["']use server["']/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    bodies.push(source.slice(match.index + match[0].length))
  }
  return bodies
}

test("RO-SURFACE-001: every server action starts with requireWrite", () => {
  const failures: string[] = []
  for (const file of walk(join(ROOT, "src", "app"))) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue
    const source = readFileSync(file, "utf8")
    serverActionBodies(source).forEach((body, index) => {
      if (!/^\s*;?\s*await requireWrite\(\)/.test(body)) {
        failures.push(`${repoPath(file)} action ${index + 1}`)
      }
    })
  }
  assert.deepEqual(failures, [])
})

test("RO-SURFACE-002: mutating APIs require write access", () => {
  const allowlist = new Set([
    "src/app/api/auth/login/route.ts",
    "src/app/api/auth/logout/route.ts",
    "src/app/api/seed/route.ts",
  ])
  const failures: string[] = []
  for (const file of walk(join(ROOT, "src", "app", "api"))) {
    if (!file.endsWith("route.ts")) continue
    const source = readFileSync(file, "utf8")
    const mutates = /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b/.test(source)
      || /export\s+const\s+(?:POST|PUT|PATCH|DELETE)\b/.test(source)
    if (!mutates) continue
    const path = repoPath(file)
    if (allowlist.has(path)) continue
    const handlerPath = join(dirname(file), "handler.ts")
    const handlerSource = existsSync(handlerPath) ? readFileSync(handlerPath, "utf8") : ""
    if (!source.includes("requireApiWrite(") && !handlerSource.includes("requireApiWrite(")) {
      failures.push(path)
    }
  }
  assert.deepEqual(failures, [])
})

test("RO-SURFACE-003: every settings page guards writes before reading data", () => {
  const pages = walk(join(ROOT, "src", "app", "settings")).filter((file) => file.endsWith(`${sep}page.tsx`))
  assert.ok(pages.length >= 3)
  for (const file of pages) {
    const source = readFileSync(file, "utf8")
    const guardAt = source.indexOf("await requireWrite()")
    const readAt = source.search(/prisma\./)
    assert.ok(guardAt >= 0, repoPath(file))
    if (readAt >= 0) assert.ok(guardAt < readAt, repoPath(file))
  }
})
