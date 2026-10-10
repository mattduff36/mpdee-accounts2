import {
  ABSENT_CALCULATION_REVISION,
  GLOBAL_CALCULATION_SETTINGS_ID,
  assertHostingPence,
  assertHostingSchedule,
  assertRateBps,
  isoDateFromDb,
  parseCalculationRates,
  parseProjectCalculationOverrides,
  type CalculationRates,
  type ProjectCalculationOverrides,
} from './calculation-settings'

export type CalculationSettingsSaveResult = {
  ok: boolean
  message: string
  globalRevision?: string
  projectRevision?: string
  rates?: CalculationRates
  overrides?: ProjectCalculationOverrides
}

export type GlobalCalculationSettingsInput = {
  expectedRevision: string
  includedPremiumBps: string
  includedGrokComposerBps: string
  onDemandBps: string
  dailyHostingPence: string
}

export type ProjectCalculationSettingsInput = {
  projectId: string
  expectedRevision: string
  expectedGlobalRevision: string
  includedPremiumBps: string | null
  includedGrokComposerBps: string | null
  onDemandBps: string | null
  dailyHostingPence: string | null
  hostingEnabled: boolean
  hostingStartDate: string | null
  hostingEndDate: string | null
}

type GlobalRow = {
  id: string
  includedPremiumBps: number
  includedGrokComposerBps: number
  onDemandBps: number
  dailyHostingPence: number
  updatedAt: Date
}

type ProjectRow = {
  projectId: string
  includedPremiumBps: number | null
  includedGrokComposerBps: number | null
  onDemandBps: number | null
  dailyHostingPence: number | null
  hostingEnabled: boolean
  hostingStartDate: Date | string | null
  hostingEndDate: Date | string | null
  updatedAt: Date
}

type GlobalWrite = {
  id?: string
  includedPremiumBps: number
  includedGrokComposerBps: number
  onDemandBps: number
  dailyHostingPence: number
  updatedAt: Date
}

type ProjectWrite = {
  projectId?: string
  includedPremiumBps: number | null
  includedGrokComposerBps: number | null
  onDemandBps: number | null
  dailyHostingPence: number | null
  hostingEnabled: boolean
  hostingStartDate: Date | null
  hostingEndDate: Date | null
  updatedAt: Date
}

export type CalculationSettingsSaveTx = {
  costCalculationSettings: {
    findUnique(args: { where: { id: string } }): Promise<GlobalRow | null>
    create(args: { data: GlobalWrite }): Promise<GlobalRow>
    update(args: { where: { id: string }; data: GlobalWrite }): Promise<GlobalRow>
  }
  costProjectCalculationSettings: {
    findUnique(args: { where: { projectId: string } }): Promise<ProjectRow | null>
    create(args: { data: ProjectWrite & { projectId: string } }): Promise<ProjectRow>
    update(args: { where: { projectId: string }; data: ProjectWrite }): Promise<ProjectRow>
  }
  costProject: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; archived: boolean } | null>
  }
  auditLog: {
    create(args: { data: { userId: string; action: string; entityType: string; entityId: string; details: string } }): Promise<unknown>
  }
}

const GLOBAL_KEYS = ['expectedRevision', 'includedPremiumBps', 'includedGrokComposerBps', 'onDemandBps', 'dailyHostingPence'] as const
const PROJECT_KEYS = [
  'projectId', 'expectedRevision', 'expectedGlobalRevision',
  'includedPremiumBps', 'includedGrokComposerBps', 'onDemandBps', 'dailyHostingPence',
  'hostingEnabled', 'hostingStartDate', 'hostingEndDate',
] as const

const CHECK_FIELDS = 'Check the calculation fields, then try again.'
const GENERIC = 'Nothing was saved. Reload the page and try again.'
const PERCENT = 'Enter a percentage from 0 to 1000, with at most two decimal places.'
const POUNDS = 'Enter a daily hosting charge from £0 to £100000, with at most two decimal places.'
const STALE_GLOBAL = 'Calculation defaults changed in another session. Reload before saving.'
const STALE_PROJECT = 'This project\'s calculation rates changed in another session. Reload before saving.'
const STALE_GLOBAL_FOR_PROJECT = 'Global calculation setup changed. Reload before saving this project.'
const ACTIVE_PROJECT = 'Choose an active project.'
const SAVED_GLOBAL = 'Saved the calculation defaults. Historical estimates use these rates. Issued invoices are unchanged.'
const SAVED_PROJECT = 'Saved this project\'s calculation rates. Historical estimates use these settings; disabling hosting removes calculated fees. Issued invoices are unchanged.'

const SAFE_DATE_MESSAGES = new Set([
  'Invalid ISO date',
  'Hosting end date requires a start date',
  'Hosting end date is before start date',
  'Hosting enabled requires a start date',
])

function failure(message: string): CalculationSettingsSaveResult {
  return { ok: false, message }
}

function inputFailure(error: unknown): CalculationSettingsSaveResult {
  const message = error instanceof Error ? error.message : ''
  if (message === 'Invalid percentage') return failure(PERCENT)
  if (message === 'Invalid pounds amount') return failure(POUNDS)
  if (SAFE_DATE_MESSAGES.has(message)) return failure(message)
  return failure(CHECK_FIELDS)
}

function exactRecord(input: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  const actual = Object.keys(record)
  if (actual.length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(record, key))) return null
  return record
}

function expectedRevision(value: unknown): string | null {
  if (value === ABSENT_CALCULATION_REVISION) return value
  if (typeof value !== 'string') return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) return null
  return value
}

function revisionOf(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('Invalid settings revision')
  return value.toISOString()
}

function nextUpdatedAt(previous: Date | null, now: Date): Date {
  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs)) throw new Error('Invalid clock')
  const earliest = previous ? previous.getTime() + 1 : nowMs
  return new Date(Math.max(nowMs, earliest))
}

function validActor(actor: { id: string }): boolean {
  return typeof actor?.id === 'string' && actor.id.length > 0 && actor.id.length <= 200
}

function resolveNow(now: Date | undefined): Date | null {
  const clock = now ?? new Date()
  if (!(clock instanceof Date) || Number.isNaN(clock.getTime())) return null
  return clock
}

function readGlobal(row: GlobalRow): { rates: CalculationRates; revision: string } {
  if (row.id !== GLOBAL_CALCULATION_SETTINGS_ID) throw new Error('Invalid calculation settings')
  return {
    rates: {
      includedPremiumBps: assertRateBps(row.includedPremiumBps),
      includedGrokComposerBps: assertRateBps(row.includedGrokComposerBps),
      onDemandBps: assertRateBps(row.onDemandBps),
      dailyHostingPence: assertHostingPence(row.dailyHostingPence),
    },
    revision: revisionOf(row.updatedAt),
  }
}

function readProject(row: ProjectRow): { overrides: ProjectCalculationOverrides; revision: string } {
  const overrides: ProjectCalculationOverrides = {
    includedPremiumBps: row.includedPremiumBps === null ? null : assertRateBps(row.includedPremiumBps),
    includedGrokComposerBps: row.includedGrokComposerBps === null ? null : assertRateBps(row.includedGrokComposerBps),
    onDemandBps: row.onDemandBps === null ? null : assertRateBps(row.onDemandBps),
    dailyHostingPence: row.dailyHostingPence === null ? null : assertHostingPence(row.dailyHostingPence),
    hostingEnabled: row.hostingEnabled,
    hostingStartDate: isoDateFromDb(row.hostingStartDate),
    hostingEndDate: isoDateFromDb(row.hostingEndDate),
  }
  assertHostingSchedule(overrides)
  return { overrides, revision: revisionOf(row.updatedAt) }
}

function utcDate(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`)
}

function assertAdvanced(previous: Date | null, saved: Date): string {
  const revision = revisionOf(saved)
  if (previous && saved.getTime() <= previous.getTime()) throw new Error('Settings revision did not advance')
  return revision
}

// The caller holds the existing cost advisory lock across this read-compare-write. There is no retry.
export async function saveGlobalCalculationSettings(
  raw: unknown,
  actor: { id: string },
  tx: CalculationSettingsSaveTx,
  now?: Date,
): Promise<CalculationSettingsSaveResult> {
  const record = exactRecord(raw, GLOBAL_KEYS)
  if (!record) return failure(CHECK_FIELDS)
  const seen = expectedRevision(record.expectedRevision)
  if (!seen) return failure(CHECK_FIELDS)
  let rates: CalculationRates
  try {
    rates = parseCalculationRates({
      includedPremiumBps: record.includedPremiumBps,
      includedGrokComposerBps: record.includedGrokComposerBps,
      onDemandBps: record.onDemandBps,
      dailyHostingPence: record.dailyHostingPence,
    })
  } catch (error) {
    return inputFailure(error)
  }
  if (!validActor(actor)) return failure(GENERIC)
  const clock = resolveNow(now)
  if (!clock) return failure(GENERIC)

  const current = await tx.costCalculationSettings.findUnique({ where: { id: GLOBAL_CALCULATION_SETTINGS_ID } })
  const before = current ? readGlobal(current) : null
  if ((before?.revision ?? ABSENT_CALCULATION_REVISION) !== seen) return failure(STALE_GLOBAL)
  const stamp = nextUpdatedAt(current?.updatedAt ?? null, clock)
  const data: GlobalWrite = { ...rates, updatedAt: stamp }
  const saved = current
    ? await tx.costCalculationSettings.update({ where: { id: GLOBAL_CALCULATION_SETTINGS_ID }, data })
    : await tx.costCalculationSettings.create({ data: { ...data, id: GLOBAL_CALCULATION_SETTINGS_ID } })
  const globalRevision = assertAdvanced(current?.updatedAt ?? null, saved.updatedAt)
  await tx.auditLog.create({
    data: {
      userId: actor.id,
      action: 'costs.calculation.global.save',
      entityType: 'CostCalculationSettings',
      entityId: GLOBAL_CALCULATION_SETTINGS_ID,
      details: JSON.stringify({ before, after: { rates, revision: globalRevision } }),
    },
  })
  return { ok: true, message: SAVED_GLOBAL, globalRevision, rates }
}

export async function saveProjectCalculationSettings(
  raw: unknown,
  actor: { id: string },
  tx: CalculationSettingsSaveTx,
  now?: Date,
): Promise<CalculationSettingsSaveResult> {
  const record = exactRecord(raw, PROJECT_KEYS)
  if (!record) return failure(CHECK_FIELDS)
  if (typeof record.projectId !== 'string' || record.projectId.length === 0 || record.projectId.length > 200) return failure(ACTIVE_PROJECT)
  const seenProject = expectedRevision(record.expectedRevision)
  const seenGlobal = expectedRevision(record.expectedGlobalRevision)
  if (!seenProject || !seenGlobal) return failure(CHECK_FIELDS)
  let overrides: ProjectCalculationOverrides
  try {
    overrides = parseProjectCalculationOverrides({
      includedPremiumBps: record.includedPremiumBps,
      includedGrokComposerBps: record.includedGrokComposerBps,
      onDemandBps: record.onDemandBps,
      dailyHostingPence: record.dailyHostingPence,
      hostingEnabled: record.hostingEnabled,
      hostingStartDate: record.hostingStartDate,
      hostingEndDate: record.hostingEndDate,
    })
  } catch (error) {
    return inputFailure(error)
  }
  if (!validActor(actor)) return failure(GENERIC)
  const clock = resolveNow(now)
  if (!clock) return failure(GENERIC)

  const project = await tx.costProject.findUnique({ where: { id: record.projectId } })
  if (!project || project.archived) return failure(ACTIVE_PROJECT)
  const globalRow = await tx.costCalculationSettings.findUnique({ where: { id: GLOBAL_CALCULATION_SETTINGS_ID } })
  const global = globalRow ? readGlobal(globalRow) : null
  if ((global?.revision ?? ABSENT_CALCULATION_REVISION) !== seenGlobal) return failure(STALE_GLOBAL_FOR_PROJECT)
  const current = await tx.costProjectCalculationSettings.findUnique({ where: { projectId: record.projectId } })
  const before = current ? readProject(current) : null
  if ((before?.revision ?? ABSENT_CALCULATION_REVISION) !== seenProject) return failure(STALE_PROJECT)

  const stamp = nextUpdatedAt(current?.updatedAt ?? null, clock)
  const data: ProjectWrite = {
    includedPremiumBps: overrides.includedPremiumBps,
    includedGrokComposerBps: overrides.includedGrokComposerBps,
    onDemandBps: overrides.onDemandBps,
    dailyHostingPence: overrides.dailyHostingPence,
    hostingEnabled: overrides.hostingEnabled,
    hostingStartDate: utcDate(overrides.hostingStartDate),
    hostingEndDate: utcDate(overrides.hostingEndDate),
    updatedAt: stamp,
  }
  const saved = current
    ? await tx.costProjectCalculationSettings.update({ where: { projectId: record.projectId }, data })
    : await tx.costProjectCalculationSettings.create({ data: { ...data, projectId: record.projectId } })
  const projectRevision = assertAdvanced(current?.updatedAt ?? null, saved.updatedAt)
  await tx.auditLog.create({
    data: {
      userId: actor.id,
      action: 'costs.calculation.project.save',
      entityType: 'CostProjectCalculationSettings',
      entityId: record.projectId,
      details: JSON.stringify({
        before,
        after: { overrides, revision: projectRevision },
        globalRevision: global?.revision ?? ABSENT_CALCULATION_REVISION,
      }),
    },
  })
  return {
    ok: true,
    message: SAVED_PROJECT,
    globalRevision: global?.revision ?? ABSENT_CALCULATION_REVISION,
    projectRevision,
    rates: global?.rates,
    overrides,
  }
}
