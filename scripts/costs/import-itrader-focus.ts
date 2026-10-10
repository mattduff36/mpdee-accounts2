import { readFileSync } from 'node:fs'
import { assertSafeDatabaseUrl, sanitizeDatabaseOutput } from '../database-target'
import {
  exactVercelResourceMapping,
  planItraderFocusImport,
  type ItraderFocusPayload,
} from '../../src/lib/costs/itrader-focus-import'

type ProjectMapping = { slug: string; mappings: Array<{ type: string; value: string }> }
type ApplyCounts = { added: number; revised: number; duplicate: number; unassigned: number }

export type ItraderFocusCliDeps = {
  readText: (path: string) => string
  now: Date
  databaseUrl: string | undefined
  loadProject: (slug: string) => Promise<ProjectMapping | null>
  applyPayloads: (payloads: ItraderFocusPayload[]) => Promise<ApplyCounts>
}

export function parseItraderFocusArgs(argv: string[]) {
  let apply = false
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (arg === '--allow-remote-db' || arg === '--allow-remote') {
      throw new Error('Remote database override is not available')
    }
    if (arg !== '--input' && arg !== '--project' && arg !== '--project-ref' && arg !== '--account-ref') {
      throw new Error('Unknown argument')
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
    values.set(arg, value)
    index += 1
  }
  const input = values.get('--input')
  const project = values.get('--project')
  const projectRef = values.get('--project-ref')
  const accountRef = values.get('--account-ref')
  if (!input || !project || !projectRef || !accountRef) throw new Error('Missing required arguments')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project)) throw new Error('Project slug is invalid')
  return { input, project, projectRef, accountRef, apply }
}

export async function runItraderFocusCli(argv: string[], deps: ItraderFocusCliDeps): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const args = parseItraderFocusArgs(argv)
    let raw: unknown
    try {
      raw = JSON.parse(deps.readText(args.input))
    } catch {
      return { exitCode: 1, stdout: '', stderr: 'Input file is not valid JSON\n' }
    }
    const plan = planItraderFocusImport(raw, {
      accountRef: args.accountRef,
      projectRef: args.projectRef,
      now: deps.now,
    })
    const text = summary(plan, false, null)
    try {
      assertSafeDatabaseUrl(deps.databaseUrl, { allowRemote: false })
      const project = await deps.loadProject(args.project)
      const mapping = exactVercelResourceMapping(project, { slug: args.project, projectRef: args.projectRef })
      if (!mapping.ok) return { exitCode: 1, stdout: text, stderr: `${mapping.reason}\n` }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Import failed'
      return { exitCode: 1, stdout: text, stderr: `${sanitizeDatabaseOutput(message)}\n` }
    }
    if (!plan.ok) return { exitCode: 1, stdout: text, stderr: 'Import plan rejected one or more rows\n' }
    if (!args.apply) return { exitCode: 0, stdout: text, stderr: '' }
    const applied = await deps.applyPayloads(plan.payloads)
    return { exitCode: 0, stdout: summary(plan, true, applied), stderr: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import failed'
    return { exitCode: 1, stdout: '', stderr: `${sanitizeDatabaseOutput(message)}\n` }
  }
}

function summary(plan: ReturnType<typeof planItraderFocusImport>, apply: boolean, applied: ApplyCounts | null): string {
  return `${JSON.stringify({
    mode: apply && applied ? 'apply' : 'dry-run',
    received: plan.received,
    accepted: plan.accepted,
    excluded: plan.excluded,
    rejected: plan.rejected,
    excludedReasons: plan.excludedReasons,
    rejectedReasons: plan.rejectedReasons,
    chunks: plan.payloads.length,
    added: applied?.added ?? null,
    revised: applied?.revised ?? null,
    duplicate: applied?.duplicate ?? null,
    unassigned: applied?.unassigned ?? null,
  })}\n`
}

async function withLocalPrisma<T>(fn: (prisma: typeof import('../../src/lib/db').prisma) => Promise<T>): Promise<T> {
  assertSafeDatabaseUrl(process.env.DATABASE_URL, { allowRemote: false })
  const { prisma } = await import('../../src/lib/db')
  try {
    return await fn(prisma)
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  const result = await runItraderFocusCli(process.argv.slice(2), {
    readText: path => readFileSync(path, 'utf8'),
    now: new Date(),
    databaseUrl: process.env.DATABASE_URL,
    loadProject: async slug => withLocalPrisma(prisma => prisma.costProject.findUnique({
      where: { slug },
      select: { slug: true, mappings: { select: { type: true, value: true } } },
    })),
    applyPayloads: async payloads => withLocalPrisma(async () => {
      const { importUsage } = await import('../../src/lib/costs/service')
      const totals = { added: 0, revised: 0, duplicate: 0, unassigned: 0 }
      for (const payload of payloads) {
        const outcome = await importUsage(payload)
        totals.added += outcome.added
        totals.revised += outcome.revised
        totals.duplicate += outcome.duplicate
        totals.unassigned += outcome.unassigned
      }
      return totals
    }),
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/costs/import-itrader-focus.ts')) {
  main()
}
