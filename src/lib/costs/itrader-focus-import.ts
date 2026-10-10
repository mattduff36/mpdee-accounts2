import { LEDGER_START } from './comparison-policy'

/** Accounts import schema hard limit. Callers cannot raise it. */
export const FOCUS_IMPORT_CHUNK_SIZE = 5000

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/
const ACCOUNT_REF = /^[a-zA-Z0-9_-]+$/
const CHECKSUM = /^[a-f0-9]{64}$/i
const CHARGE_CATEGORIES = new Set(['Adjustment', 'Credit', 'Purchase', 'Tax', 'Usage'])
const NEGATIVE_CATEGORIES = new Set(['Adjustment', 'Credit'])

export type ItraderFocusImportConfig = {
  accountRef: string
  projectRef: string
  now: Date
  ledgerStart?: string
  chunkSize?: number
}

export type ItraderFocusPayload = {
  version: 'mpdee-costs-v1'
  provider: 'vercel'
  accountRef: string
  quality: 'complete'
  events: Array<{
    timestamp: string
    sourceId: string
    billedAmount: string
    currency: 'USD' | 'GBP' | 'EUR'
    resourceRef: string
    description: string
  }>
}

export type ItraderFocusImportPlan = {
  ok: boolean
  received: number
  accepted: number
  excluded: number
  rejected: number
  excludedReasons: Record<string, number>
  rejectedReasons: Record<string, number>
  payloads: ItraderFocusPayload[]
  audit: Array<{ sourceId: string; revision: number; checksum: string }>
}

type ReasonMap = Map<string, number>

type ExportRow = {
  sourceId: string
  revision: number
  checksum: string
  periodStart: string
  periodEnd: string
  classified: boolean
  quarantined: boolean
  quarantineReason: string | null
  category: string | null
  billedAmount: string | null
  currency: string | null
  serviceName: string | null
}

type Envelope = {
  accountRef: string
  sourceProjectRef: string
  databaseResourceRefs: string[]
  rows: unknown[]
}

export function planItraderFocusImport(raw: unknown, config: ItraderFocusImportConfig): ItraderFocusImportPlan {
  const chunkSize = config.chunkSize ?? FOCUS_IMPORT_CHUNK_SIZE
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > FOCUS_IMPORT_CHUNK_SIZE) {
    throw new Error('FOCUS import chunk size must be from 1 to 5000')
  }
  if (!(config.now instanceof Date) || !Number.isFinite(config.now.getTime())) throw new Error('FOCUS import now is invalid')
  const ledgerStart = config.ledgerStart ?? LEDGER_START
  if (!canonicalInstant(ledgerStart)) throw new Error('FOCUS import ledger boundary is invalid')
  if (!validAccountRef(config.accountRef) || !validProjectRef(config.projectRef)) {
    throw new Error('FOCUS import account or project ref is invalid')
  }

  const excluded = new Map<string, number>()
  const rejected = new Map<string, number>()
  const envelope = parseEnvelope(raw)
  if (!envelope.ok) {
    bump(rejected, envelope.reason)
    return finish(0, [], [], excluded, rejected, config, chunkSize)
  }
  if (envelope.value.accountRef !== config.accountRef) {
    return rejectFile(envelope.value.rows.length, 'account-mismatch', excluded, rejected, config, chunkSize)
  }
  if (envelope.value.sourceProjectRef !== config.projectRef) {
    return rejectFile(envelope.value.rows.length, 'project-mismatch', excluded, rejected, config, chunkSize)
  }
  if (envelope.value.databaseResourceRefs.includes(config.projectRef)) {
    return rejectFile(envelope.value.rows.length, 'project-listed-as-database', excluded, rejected, config, chunkSize)
  }

  const seen = new Map<string, number>()
  for (const item of envelope.value.rows) {
    const sourceId = sourceIdOf(item)
    if (sourceId) seen.set(sourceId, (seen.get(sourceId) ?? 0) + 1)
  }

  const accepted: ItraderFocusPayload['events'] = []
  const audit: ItraderFocusImportPlan['audit'] = []
  for (const item of envelope.value.rows) {
    const sourceId = sourceIdOf(item)
    if (sourceId && (seen.get(sourceId) ?? 0) > 1) {
      bump(rejected, 'conflicting-identity')
      continue
    }
    const row = parseRow(item)
    if (!row) {
      bump(rejected, 'row-shape')
      continue
    }
    const decision = decideRow(row, config, ledgerStart)
    if (decision.action === 'reject') {
      bump(rejected, decision.reason)
      continue
    }
    if (decision.action === 'exclude') {
      bump(excluded, decision.reason)
      continue
    }
    accepted.push(decision.event)
    audit.push(decision.audit)
  }
  return finish(envelope.value.rows.length, accepted, audit, excluded, rejected, config, chunkSize)
}

export function exactVercelResourceMapping(
  project: { slug: string; mappings: Array<{ type: string; value: string }> } | null,
  expected: { slug: string; projectRef: string },
): { ok: true } | { ok: false; reason: string } {
  if (!project || project.slug !== expected.slug) return { ok: false, reason: 'Project slug was not found' }
  const vercel = project.mappings.filter(mapping => mapping.type === 'vercel-resource')
  if (vercel.length !== 1 || vercel[0].value !== expected.projectRef) {
    return { ok: false, reason: 'Project is missing the exact vercel-resource mapping' }
  }
  return { ok: true }
}

function rejectFile(
  received: number,
  reason: string,
  excluded: ReasonMap,
  rejected: ReasonMap,
  config: ItraderFocusImportConfig,
  chunkSize: number,
): ItraderFocusImportPlan {
  rejected.set(reason, Math.max(received, 1))
  return finish(received, [], [], excluded, rejected, config, chunkSize)
}

function finish(
  received: number,
  events: ItraderFocusPayload['events'],
  audit: ItraderFocusImportPlan['audit'],
  excluded: ReasonMap,
  rejected: ReasonMap,
  config: ItraderFocusImportConfig,
  chunkSize: number,
): ItraderFocusImportPlan {
  const payloads: ItraderFocusPayload[] = []
  for (let offset = 0; offset < events.length; offset += chunkSize) {
    payloads.push({
      version: 'mpdee-costs-v1',
      provider: 'vercel',
      accountRef: config.accountRef,
      quality: 'complete',
      events: events.slice(offset, offset + chunkSize),
    })
  }
  const excludedCount = count(excluded)
  const rejectedCount = count(rejected)
  return {
    ok: rejectedCount === 0,
    received,
    accepted: events.length,
    excluded: excludedCount,
    rejected: rejectedCount,
    excludedReasons: objectOf(excluded),
    rejectedReasons: objectOf(rejected),
    payloads,
    audit,
  }
}

function sourceIdOf(item: unknown): string | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const sourceId = (item as Record<string, unknown>).sourceId
  return typeof sourceId === 'string' && sourceId.length > 0 ? sourceId : null
}

function decideRow(
  row: ExportRow,
  config: ItraderFocusImportConfig,
  ledgerStart: string,
):
  | { action: 'reject'; reason: string }
  | { action: 'exclude'; reason: string }
  | { action: 'accept'; event: ItraderFocusPayload['events'][number]; audit: ItraderFocusImportPlan['audit'][number] } {
  const periodStart = canonicalInstant(row.periodStart)
  const periodEnd = canonicalInstant(row.periodEnd)
  if (!periodStart || !periodEnd) return { action: 'reject', reason: 'invalid-period' }
  if (periodEnd <= periodStart) return { action: 'reject', reason: 'inverted-period' }
  if (periodStart > config.now.toISOString()) return { action: 'reject', reason: 'future-start' }

  if (row.quarantined) return { action: 'exclude', reason: 'quarantine' }
  if (!row.classified) return { action: 'exclude', reason: 'unclassified' }
  if (row.sourceId.startsWith('vercel:membership:')) return { action: 'exclude', reason: 'synthetic-membership' }
  if (row.category === 'SHARED_VERCEL' || row.sourceId.startsWith('vercel:SHARED_VERCEL:')) return { action: 'exclude', reason: 'shared' }
  if (row.category === 'DATABASE' || row.sourceId.startsWith('vercel:DATABASE:')) return { action: 'exclude', reason: 'database' }
  if (row.category == null) return { action: 'exclude', reason: 'missing-attribution' }
  if (row.category !== 'VERCEL_HOSTING') return { action: 'exclude', reason: 'unknown-attribution' }

  const identity = parseHostingIdentity(row.sourceId, config.projectRef, row.serviceName, periodStart, periodEnd)
  if (!identity.ok) {
    if (identity.reason === 'foreign-project') return { action: 'exclude', reason: 'foreign-project' }
    return { action: 'reject', reason: identity.reason }
  }
  if (identity.chargeCategory === 'Tax') return { action: 'exclude', reason: 'tax' }
  if (!CHARGE_CATEGORIES.has(identity.chargeCategory)) return { action: 'reject', reason: 'unknown-charge-category' }
  if (periodStart < ledgerStart) return { action: 'exclude', reason: 'before-boundary' }

  if (row.billedAmount == null) return { action: 'reject', reason: 'missing-amount' }
  if (!DECIMAL.test(row.billedAmount) || row.billedAmount.length > 60) return { action: 'reject', reason: 'invalid-amount' }
  if (row.billedAmount.startsWith('-') && !NEGATIVE_CATEGORIES.has(identity.chargeCategory)) {
    return { action: 'reject', reason: 'negative-amount' }
  }
  if (row.currency !== 'USD' && row.currency !== 'GBP' && row.currency !== 'EUR') {
    return { action: 'reject', reason: 'unsupported-currency' }
  }
  if (!row.serviceName || row.serviceName.length > 300) return { action: 'reject', reason: 'service-name' }

  return {
    action: 'accept',
    event: {
      timestamp: periodStart,
      sourceId: row.sourceId,
      billedAmount: row.billedAmount,
      currency: row.currency,
      resourceRef: config.projectRef,
      description: row.serviceName,
    },
    audit: { sourceId: row.sourceId, revision: row.revision, checksum: row.checksum },
  }
}

function parseHostingIdentity(
  sourceId: string,
  projectRef: string,
  serviceName: string | null,
  periodStart: string,
  periodEnd: string,
): { ok: true; chargeCategory: string } | { ok: false; reason: string } {
  if (sourceId.length > 1000) return { ok: false, reason: 'invalid-source-id' }
  const foreignHead = 'vercel:VERCEL_HOSTING:'
  if (!sourceId.startsWith(foreignHead)) return { ok: false, reason: 'ambiguous-identity' }
  const afterCategory = sourceId.slice(foreignHead.length)
  const projectSplit = afterCategory.indexOf(':')
  if (projectSplit <= 0) return { ok: false, reason: 'ambiguous-identity' }
  const sourceProject = afterCategory.slice(0, projectSplit)
  if (sourceProject !== projectRef) return { ok: false, reason: 'foreign-project' }
  const suffix = `:${periodStart}:${periodEnd}`
  const head = `vercel:VERCEL_HOSTING:${projectRef}:`
  if (!sourceId.startsWith(head) || !sourceId.endsWith(suffix) || sourceId.length <= head.length + suffix.length) {
    return { ok: false, reason: 'ambiguous-identity' }
  }
  if (!serviceName) return { ok: false, reason: 'service-name' }
  const middle = sourceId.slice(head.length, sourceId.length - suffix.length)
  if (!middle.startsWith(`${serviceName}:`)) return { ok: false, reason: 'ambiguous-identity' }
  const tail = middle.slice(serviceName.length + 1).split(':')
  if (tail.length !== 6) return { ok: false, reason: 'ambiguous-identity' }
  return { ok: true, chargeCategory: tail[1] }
}

function parseEnvelope(raw: unknown): { ok: true; value: Envelope } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'envelope' }
  const record = raw as Record<string, unknown>
  if (record.version !== 'itrader-focus-export-v1') return { ok: false, reason: 'envelope' }
  if (record.sourceReadOnly !== true) return { ok: false, reason: 'envelope' }
  if (typeof record.exportedAt !== 'string' || !canonicalInstant(record.exportedAt)) return { ok: false, reason: 'envelope' }
  if (typeof record.accountRef !== 'string' || !validAccountRef(record.accountRef)) return { ok: false, reason: 'envelope' }
  if (typeof record.sourceProjectRef !== 'string' || !validProjectRef(record.sourceProjectRef)) return { ok: false, reason: 'envelope' }
  if (!Array.isArray(record.databaseResourceRefs) || record.databaseResourceRefs.some(item => typeof item !== 'string' || item.length === 0 || item.includes(':'))) {
    return { ok: false, reason: 'envelope' }
  }
  if (!Array.isArray(record.rows)) return { ok: false, reason: 'envelope' }
  return {
    ok: true,
    value: {
      accountRef: record.accountRef,
      sourceProjectRef: record.sourceProjectRef,
      databaseResourceRefs: record.databaseResourceRefs as string[],
      rows: record.rows,
    },
  }
}

function parseRow(item: unknown): ExportRow | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const row = item as Record<string, unknown>
  if (typeof row.sourceId !== 'string' || row.sourceId.length < 1) return null
  if (typeof row.revision !== 'number' || !Number.isInteger(row.revision) || row.revision < 1) return null
  if (typeof row.checksum !== 'string' || !CHECKSUM.test(row.checksum)) return null
  if (typeof row.periodStart !== 'string' || typeof row.periodEnd !== 'string') return null
  if (typeof row.classified !== 'boolean' || typeof row.quarantined !== 'boolean') return null
  if (!(row.quarantineReason === null || typeof row.quarantineReason === 'string')) return null
  if (!(row.category === null || typeof row.category === 'string')) return null
  if (!(row.billedAmount === null || typeof row.billedAmount === 'string')) return null
  if (!(row.currency === null || typeof row.currency === 'string')) return null
  if (!(row.serviceName === null || typeof row.serviceName === 'string')) return null
  return {
    sourceId: row.sourceId,
    revision: row.revision,
    checksum: row.checksum,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    classified: row.classified,
    quarantined: row.quarantined,
    quarantineReason: row.quarantineReason,
    category: row.category,
    billedAmount: row.billedAmount,
    currency: row.currency,
    serviceName: row.serviceName,
  }
}

function canonicalInstant(value: string): string | null {
  if (!ISO_UTC.test(value)) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return date.toISOString() === value ? value : null
}

function validAccountRef(value: string): boolean {
  return value.length >= 3 && value.length <= 100 && ACCOUNT_REF.test(value)
}

function validProjectRef(value: string): boolean {
  return value.length >= 1 && value.length <= 250 && !value.includes(':') && !/\s/.test(value)
}

function bump(map: ReasonMap, reason: string) {
  map.set(reason, (map.get(reason) ?? 0) + 1)
}

function count(map: ReasonMap): number {
  let total = 0
  for (const value of map.values()) total += value
  return total
}

function objectOf(map: ReasonMap): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)))
}
