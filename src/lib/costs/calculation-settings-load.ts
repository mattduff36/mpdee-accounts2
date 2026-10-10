import {
  ABSENT_CALCULATION_REVISION,
  GLOBAL_CALCULATION_SETTINGS_ID,
  DEFAULT_CALCULATION_RATES,
  assertHostingPence,
  assertHostingSchedule,
  assertRateBps,
  isoDateFromDb,
  resolveCalculationRates,
  type CalculationRates,
  type HostingSchedule,
  type ProjectCalculationOverrides,
} from './calculation-settings'

export type GlobalCalculationSettingsRow = {
  id: string
  includedPremiumBps: number
  includedGrokComposerBps: number
  onDemandBps: number
  dailyHostingPence: number
  updatedAt: Date
}

export type ProjectCalculationSettingsRow = {
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

export type CalculationSettingsDb = {
  costCalculationSettings: {
    findUnique(args: { where: { id: string } }): Promise<GlobalCalculationSettingsRow | null>
  }
  costProjectCalculationSettings: {
    findMany(): Promise<ProjectCalculationSettingsRow[]>
  }
}

export type ResolvedProjectCalculation = {
  rates: CalculationRates
  schedule: HostingSchedule
  revision: string
  globalRevision: string
}

export type LoadedCalculationSettings = {
  global: CalculationRates
  globalRevision: string
  projects: ReadonlyMap<string, ProjectCalculationOverrides>
  projectRevisions: ReadonlyMap<string, string>
  resolve(projectId: string): ResolvedProjectCalculation
}

function revisionFromUpdatedAt(value: unknown): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('Invalid settings revision')
  return value.toISOString()
}

function storedNullableBps(value: number | null): number | null {
  if (value === null) return null
  return assertRateBps(value)
}

function storedNullablePence(value: number | null): number | null {
  if (value === null) return null
  return assertHostingPence(value)
}

function mapGlobal(row: GlobalCalculationSettingsRow): { rates: CalculationRates; revision: string } {
  if (row.id !== GLOBAL_CALCULATION_SETTINGS_ID) throw new Error('Invalid calculation settings')
  return {
    rates: {
      includedPremiumBps: assertRateBps(row.includedPremiumBps),
      includedGrokComposerBps: assertRateBps(row.includedGrokComposerBps),
      onDemandBps: assertRateBps(row.onDemandBps),
      dailyHostingPence: assertHostingPence(row.dailyHostingPence),
    },
    revision: revisionFromUpdatedAt(row.updatedAt),
  }
}

function mapProject(row: ProjectCalculationSettingsRow): { projectId: string; overrides: ProjectCalculationOverrides; revision: string } {
  if (typeof row.projectId !== 'string' || row.projectId === '') throw new Error('Invalid calculation settings')
  const overrides: ProjectCalculationOverrides = {
    includedPremiumBps: storedNullableBps(row.includedPremiumBps),
    includedGrokComposerBps: storedNullableBps(row.includedGrokComposerBps),
    onDemandBps: storedNullableBps(row.onDemandBps),
    dailyHostingPence: storedNullablePence(row.dailyHostingPence),
    hostingEnabled: row.hostingEnabled,
    hostingStartDate: isoDateFromDb(row.hostingStartDate),
    hostingEndDate: isoDateFromDb(row.hostingEndDate),
  }
  assertHostingSchedule(overrides)
  return { projectId: row.projectId, overrides, revision: revisionFromUpdatedAt(row.updatedAt) }
}

async function defaultCalculationDb(): Promise<CalculationSettingsDb> {
  const { prisma } = await import('../db')
  return prisma as unknown as CalculationSettingsDb
}

export async function loadCalculationSettings(db?: CalculationSettingsDb): Promise<LoadedCalculationSettings> {
  const source = db ?? await defaultCalculationDb()
  const [globalRow, projectRows] = await Promise.all([
    source.costCalculationSettings.findUnique({ where: { id: GLOBAL_CALCULATION_SETTINGS_ID } }),
    source.costProjectCalculationSettings.findMany(),
  ])
  const global = globalRow ? mapGlobal(globalRow) : { rates: { ...DEFAULT_CALCULATION_RATES }, revision: ABSENT_CALCULATION_REVISION }
  const projects = new Map<string, ProjectCalculationOverrides>()
  const projectRevisions = new Map<string, string>()
  for (const row of projectRows) {
    const mapped = mapProject(row)
    if (projects.has(mapped.projectId)) throw new Error('Duplicate project calculation settings')
    projects.set(mapped.projectId, mapped.overrides)
    projectRevisions.set(mapped.projectId, mapped.revision)
  }
  return {
    global: global.rates,
    globalRevision: global.revision,
    projects,
    projectRevisions,
    resolve(projectId: string): ResolvedProjectCalculation {
      if (typeof projectId !== 'string' || projectId === '') throw new Error('Invalid project')
      const override = projects.get(projectId) ?? null
      const schedule: HostingSchedule = override
        ? { hostingEnabled: override.hostingEnabled, hostingStartDate: override.hostingStartDate, hostingEndDate: override.hostingEndDate }
        : { hostingEnabled: false, hostingStartDate: null, hostingEndDate: null }
      return {
        rates: resolveCalculationRates(global.rates, override),
        schedule,
        revision: projectRevisions.get(projectId) ?? ABSENT_CALCULATION_REVISION,
        globalRevision: global.revision,
      }
    },
  }
}
