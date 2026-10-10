import { prisma } from '@/lib/db'
import { loadCalculationSettings, type LoadedCalculationSettings, type ResolvedProjectCalculation } from './calculation-settings-load'
import { dailyHostingFees, type DailyHostingFee } from './daily-hosting'
import { ledgerFx } from './fx'
import { projectSnapshot, type ProjectSnapshotOptions } from './project-snapshot'
import { firstInclusiveUtcDate } from './provisional-estimate'
import { resolvePolicy, type DatedPolicy } from './service'

const SNAPSHOT_EVENT_LIMIT = 50000

export type SnapshotLoadProject = { id: string; slug: string; clientId: string | null; archived: boolean }

type SnapshotRevision = {
  id: string
  revision: number
  checksum: string
  createdAt: Date
  funding: string
  nominalUnits: bigint | null
  providerUnits: bigint | null
  currency: string
  quality: string
  fxGbp?: { toString(): string } | null
  evidence?: unknown
}

type SnapshotEvent = {
  id: string
  provider: string
  accountRef: string
  sourceKey: string
  occurredAt: Date
  model: string | null
  revisions: SnapshotRevision[]
}

export type LoadedSnapshotRow = {
  event: { id: string; provider: string; occurredAt: Date; model: string | null; sourceKey: string }
  revision?: SnapshotRevision
  policy: (DatedPolicy & { id: string }) | null
  hold: string | null
  fx: Awaited<ReturnType<typeof ledgerFx>>['quotes'][number]
}

export type SnapshotCalculation = {
  rates: ResolvedProjectCalculation['rates']
  schedule: ResolvedProjectCalculation['schedule']
  revision: string
  globalRevision: string
}

export type SnapshotLoadDeps = {
  db?: {
    costProject: { findUnique: (args: { where: { slug: string } }) => Promise<SnapshotLoadProject | null> }
    costUsageEvent: { findMany: (args: Record<string, unknown>) => Promise<SnapshotEvent[]> }
    costPolicy: { findMany: (args: Record<string, unknown>) => Promise<DatedPolicy[]> }
    costImportRun: { findFirst: (args: Record<string, unknown>) => Promise<{ createdAt: Date } | null> }
  }
  fx?: typeof ledgerFx
  /** Required when `db` is injected. Production reads settings once through the real loader. */
  settings?: () => Promise<LoadedCalculationSettings>
}

export type LoadedProjectSnapshot = {
  ok: true
  project: SnapshotLoadProject
  rows: LoadedSnapshotRow[]
  imports: Date[]
  from: string | null
  asOf: Date
  hostingFees: DailyHostingFee[]
  calculation: SnapshotCalculation
}

export type SnapshotLoadResult =
  | LoadedProjectSnapshot
  | { ok: false; status: 404 | 422; error: string; limit?: number }

/** Synthetic daily membership rows are overhead, not a second client charge. */
export function isSyntheticMembershipSource(sourceKey: string) {
  return sourceKey.startsWith('vercel:membership:')
}

/** Only an explicit source flag. Resource similarity is not coverage. */
export function isExplicitProviderInvoiceCoverage(evidence: unknown) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false
  const covered = (evidence as { coveredByProviderInvoice?: unknown }).coveredByProviderInvoice
  return covered === true || covered === 'true'
}

export function chargeableBillingRows<T extends { event: { sourceKey: string }; revision?: { evidence?: unknown } | null }>(rows: T[]) {
  return rows.filter(row => !isSyntheticMembershipSource(row.event.sourceKey) && !isExplicitProviderInvoiceCoverage(row.revision?.evidence))
}

async function calculationSettings(deps: SnapshotLoadDeps): Promise<LoadedCalculationSettings> {
  if (deps.settings) return deps.settings()
  if (deps.db) throw new Error('Calculation settings dependency required')
  return loadCalculationSettings()
}

/** First charged day is the schedule start when the caller did not request a window. */
function hostingFeesFor(projectId: string, resolved: ResolvedProjectCalculation, from: string | null, asOf: Date): DailyHostingFee[] {
  if (!resolved.schedule.hostingEnabled || resolved.rates.dailyHostingPence === 0) return []
  const start = from === null ? resolved.schedule.hostingStartDate : firstInclusiveUtcDate(from)
  if (start === null) throw new Error('Hosting enabled requires a start date')
  const asOfDay = asOf.toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  return dailyHostingFees(projectId, resolved.rates, resolved.schedule, { from: start, asOf: asOfDay, today })
}

function occurredBy(asOf: Date) {
  const end = asOf.getTime()
  return (event: { occurredAt: Date }) => event.occurredAt.getTime() <= end
}

function includedSnapshotEvent(event: SnapshotEvent) {
  return !isSyntheticMembershipSource(event.sourceKey) && !isExplicitProviderInvoiceCoverage(event.revisions[0]?.evidence)
}

/**
 * Read path shared with the public snapshot route and project billing.
 * Drops events after asOf, synthetic membership rows, and explicit provider-invoice coverage before FX indexing.
 */
export async function loadProjectSnapshot(slug: string, options: { from: string | null; asOf: Date }, deps: SnapshotLoadDeps = {}): Promise<SnapshotLoadResult> {
  const db = deps.db ?? (prisma as unknown as NonNullable<SnapshotLoadDeps['db']>)
  const fxFor = deps.fx ?? ledgerFx
  const asOf = options.asOf
  const from = options.from
  const project = await db.costProject.findUnique({ where: { slug } })
  if (!project || project.archived) return { ok: false, status: 404, error: 'Project not found' }
  const occurredAt = from ? { gte: new Date(from), lte: asOf } : { lte: asOf }
  const [events, policies, settings] = await Promise.all([
    db.costUsageEvent.findMany({ where: { projectId: project.id, occurredAt }, include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } }, orderBy: { id: 'asc' }, take: SNAPSHOT_EVENT_LIMIT + 1 }),
    db.costPolicy.findMany({ where: { OR: [{ projectId: project.id }, ...(project.clientId ? [{ projectId: null, clientId: project.clientId }] : [])] } }),
    calculationSettings(deps),
  ])
  const resolved = settings.resolve(project.id)
  const visible = events.filter(occurredBy(asOf))
  if (visible.length > SNAPSHOT_EVENT_LIMIT) return { ok: false, status: 422, error: 'Complete project history exceeds snapshot limit', limit: SNAPSHOT_EVENT_LIMIT }
  const included = visible.filter(includedSnapshotEvent)
  const rows = included.map(event => {
    const revision = event.revisions[0]
    const dated = resolvePolicy(policies, project.id, project.clientId, event.occurredAt)
    const policy = dated ? { ...dated, rates: resolved.rates } : null
    const hold = !revision ? 'Missing revision' : revision.quality !== 'complete' ? 'Source requires review' : !policy ? 'No effective charging policy' : null
    return {
      event: { id: event.id, provider: event.provider, occurredAt: event.occurredAt, model: event.model, sourceKey: event.sourceKey },
      revision,
      policy,
      hold,
    }
  })
  const accounts = Array.from(new Map(included.map(event => [event.provider + ':' + event.accountRef, { provider: event.provider, accountRef: event.accountRef }])).values())
  const [fx, latestImport] = await Promise.all([
    fxFor(rows.map(row => ({
      event: row.event,
      revision: row.revision ? { currency: row.revision.currency, fxGbp: row.revision.fxGbp ?? null } : undefined,
    }))),
    accounts.length ? db.costImportRun.findFirst({ where: { OR: accounts }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }) : Promise.resolve(null),
  ])
  return {
    ok: true,
    project,
    rows: rows.map((row, index) => ({ ...row, fx: fx.quotes[index] })),
    imports: latestImport ? [latestImport.createdAt] : [],
    from,
    asOf,
    hostingFees: hostingFeesFor(project.id, resolved, from, asOf),
    calculation: { rates: resolved.rates, schedule: resolved.schedule, revision: resolved.revision, globalRevision: resolved.globalRevision },
  }
}

export function buildLoadedProjectSnapshot(loaded: LoadedProjectSnapshot) {
  const options: ProjectSnapshotOptions = {
    rates: loaded.calculation.rates,
    hostingFees: loaded.hostingFees,
    globalRevision: loaded.calculation.globalRevision,
    projectRevision: loaded.calculation.revision,
    hostingSchedule: loaded.calculation.schedule,
  }
  return projectSnapshot(loaded.project.slug, loaded.rows, loaded.asOf, loaded.imports, loaded.from, options)
}
