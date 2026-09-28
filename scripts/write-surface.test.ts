import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { test } from "node:test"
import ts from "typescript"

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

function hasServerDirective(statements: ts.NodeArray<ts.Statement>): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false
    if (statement.expression.text === "use server") return true
  }
  return false
}

function serverActionBodies(source: string): ts.ConciseBody[] {
  const file = ts.createSourceFile("surface.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const moduleAction = hasServerDirective(file.statements)
  const namedExports = new Set<string>()
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) namedExports.add((element.propertyName || element.name).text)
    }
  }
  const exported = (node: ts.Node) => ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword)
  const bodies = new Set<ts.ConciseBody>()
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) {
      const body = node.body
      if (body) {
        const inlineAction = ts.isBlock(body) && hasServerDirective(body.statements)
        let moduleExport = moduleAction && ts.isFunctionDeclaration(node) && node.parent === file &&
          (exported(node) || !!node.name && namedExports.has(node.name.text))
        if (moduleAction && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
          const list = node.parent.parent, statement = list.parent
          moduleExport = ts.isVariableDeclarationList(list) && ts.isVariableStatement(statement) && statement.parent === file &&
            (exported(statement) || namedExports.has(node.parent.name.text))
        }
        if (moduleAction && ts.isExportAssignment(node.parent)) moduleExport = true
        if (inlineAction || moduleExport) bodies.add(body)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return Array.from(bodies)
}

function startsWithWriteGuard(body: ts.ConciseBody): boolean {
  if (!ts.isBlock(body)) return false
  const first = body.statements.find(statement => !ts.isEmptyStatement(statement) &&
    !(ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)))
  if (!first || !ts.isExpressionStatement(first) || !ts.isAwaitExpression(first.expression)) return false
  const call = first.expression.expression
  return ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === "requireWrite" && call.arguments.length === 0
}

// Exercise both syntax forms and inspect every action, rather than accepting a guard anywhere in the module.
test("RO-SURFACE scanner recognises module actions and rejects an unguarded second export", () => {
  const bodies = serverActionBodies(`'use server'; import { requireWrite } from './auth';
    export async function safe() { await requireWrite(); await save(); }
    export async function unsafe() { await save(); }
    export const arrow = async () => { await requireWrite(); await save(); };
    async function renamed() { await save(); }
    export { renamed as saveThing };
    const localHelper = async () => { await save(); };`)
  assert.equal(bodies.length, 4)
  assert.deepEqual(bodies.map(startsWithWriteGuard), [true, false, true, false])
})

test("RO-SURFACE scanner catches unguarded inline actions and ignores comments", () => {
  const bodies = serverActionBodies(`// 'use server' is only a comment
    async function page() {
      async function safe() { 'use server'; await requireWrite(); await save(); }
      const unsafe = async () => { 'use server'; await save(); await requireWrite(); };
      async function late() { 'use server'; const changed = mutate(); await requireWrite(); }
      return null;
    }`)
  assert.equal(bodies.length, 3)
  assert.deepEqual(bodies.map(startsWithWriteGuard), [true, false, false])
})

test("RO-SURFACE scanner rejects expression-body and non-awaited guards", () => {
  const bodies = serverActionBodies(`'use server';
    export const unsafe = async () => save();
    export default async function () { requireWrite(); await save(); }`)
  assert.equal(bodies.length, 2)
  assert.deepEqual(bodies.map(startsWithWriteGuard), [false, false])
})

test("RO-SURFACE-001: every server action starts with requireWrite", () => {
  const failures: string[] = []
  for (const file of walk(join(ROOT, "src", "app"))) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue
    const source = readFileSync(file, "utf8")
    serverActionBodies(source).forEach((body, index) => {
      if (!startsWithWriteGuard(body)) {
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
