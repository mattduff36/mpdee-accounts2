export const MAX_RATE_BPS = 100_000
export const MAX_HOSTING_PENCE = 10_000_000
export const GLOBAL_CALCULATION_SETTINGS_ID = 'global'
export const ABSENT_CALCULATION_REVISION = 'absent'

export type CalculationRates = {
  includedPremiumBps: number
  includedGrokComposerBps: number
  onDemandBps: number
  dailyHostingPence: number
}

export const DEFAULT_CALCULATION_RATES: CalculationRates = {
  includedPremiumBps: 5000,
  includedGrokComposerBps: 0,
  onDemandBps: 10000,
  dailyHostingPence: 0,
}

export type HostingSchedule = {
  hostingEnabled: boolean
  hostingStartDate: string | null
  hostingEndDate: string | null
}

export type ProjectCalculationOverrides = HostingSchedule & {
  includedPremiumBps: number | null
  includedGrokComposerBps: number | null
  onDemandBps: number | null
  dailyHostingPence: number | null
}

const PERCENTAGE_TEXT = /^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/
const POUNDS_TEXT = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/
const ISO_DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/

export function assertRateBps(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_RATE_BPS) {
    throw new Error('Invalid percentage')
  }
  return value
}

export function assertHostingPence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_HOSTING_PENCE) {
    throw new Error('Invalid pounds amount')
  }
  return value
}

export function parsePercentageBps(value: unknown): number {
  if (typeof value !== 'string' || !PERCENTAGE_TEXT.test(value)) throw new Error('Invalid percentage')
  const [whole, fraction = ''] = value.split('.')
  const bps = Number(whole) * 100 + Number((fraction + '00').slice(0, 2))
  return assertRateBps(bps)
}

export function parsePoundsToPence(value: unknown): number {
  if (typeof value !== 'string' || !POUNDS_TEXT.test(value)) throw new Error('Invalid pounds amount')
  const [whole, fraction = ''] = value.split('.')
  const pence = Number(whole) * 100 + Number((fraction + '00').slice(0, 2))
  return assertHostingPence(pence)
}

export function parseIsoDate(value: unknown): string {
  if (typeof value !== 'string' || !ISO_DATE_TEXT.test(value)) throw new Error('Invalid ISO date')
  const utc = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(utc.getTime()) || utc.toISOString().slice(0, 10) !== value) throw new Error('Invalid ISO date')
  return value
}

export function isoDateFromDb(value: unknown): string | null {
  if (value === null) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Invalid ISO date')
    const iso = value.toISOString()
    if (!iso.endsWith('T00:00:00.000Z')) throw new Error('Invalid ISO date')
    return parseIsoDate(iso.slice(0, 10))
  }
  return parseIsoDate(value)
}

export function assertHostingSchedule(schedule: HostingSchedule): void {
  if (typeof schedule.hostingEnabled !== 'boolean') throw new Error('Invalid calculation settings')
  if (schedule.hostingStartDate !== null) parseIsoDate(schedule.hostingStartDate)
  if (schedule.hostingEndDate !== null) {
    parseIsoDate(schedule.hostingEndDate)
    if (schedule.hostingStartDate === null) throw new Error('Hosting end date requires a start date')
    if (schedule.hostingEndDate < schedule.hostingStartDate) throw new Error('Hosting end date is before start date')
  }
  if (schedule.hostingEnabled && schedule.hostingStartDate === null) throw new Error('Hosting enabled requires a start date')
}

function settingsObject(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid calculation settings')
  const record = input as Record<string, unknown>
  const actual = Object.keys(record)
  if (actual.length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(record, key))) {
    throw new Error('Invalid calculation settings')
  }
  return record
}

function nullablePercentage(value: unknown): number | null {
  if (value === null) return null
  return parsePercentageBps(value)
}

function nullablePence(value: unknown): number | null {
  if (value === null) return null
  return parsePoundsToPence(value)
}

function nullableDate(value: unknown): string | null {
  if (value === null) return null
  return parseIsoDate(value)
}

export function parseCalculationRates(input: unknown): CalculationRates {
  const record = settingsObject(input, ['includedPremiumBps', 'includedGrokComposerBps', 'onDemandBps', 'dailyHostingPence'])
  return {
    includedPremiumBps: parsePercentageBps(record.includedPremiumBps),
    includedGrokComposerBps: parsePercentageBps(record.includedGrokComposerBps),
    onDemandBps: parsePercentageBps(record.onDemandBps),
    dailyHostingPence: parsePoundsToPence(record.dailyHostingPence),
  }
}

export function parseProjectCalculationOverrides(input: unknown): ProjectCalculationOverrides {
  const record = settingsObject(input, [
    'includedPremiumBps', 'includedGrokComposerBps', 'onDemandBps', 'dailyHostingPence',
    'hostingEnabled', 'hostingStartDate', 'hostingEndDate',
  ])
  if (typeof record.hostingEnabled !== 'boolean') throw new Error('Invalid calculation settings')
  const overrides: ProjectCalculationOverrides = {
    includedPremiumBps: nullablePercentage(record.includedPremiumBps),
    includedGrokComposerBps: nullablePercentage(record.includedGrokComposerBps),
    onDemandBps: nullablePercentage(record.onDemandBps),
    dailyHostingPence: nullablePence(record.dailyHostingPence),
    hostingEnabled: record.hostingEnabled,
    hostingStartDate: nullableDate(record.hostingStartDate),
    hostingEndDate: nullableDate(record.hostingEndDate),
  }
  assertHostingSchedule(overrides)
  return overrides
}

export function resolveCalculationRates(global: CalculationRates, override: ProjectCalculationOverrides | null): CalculationRates {
  if (override !== null && (override === undefined || typeof override !== 'object')) throw new Error('Invalid calculation settings')
  const resolved: CalculationRates = {
    includedPremiumBps: assertRateBps(global.includedPremiumBps),
    includedGrokComposerBps: assertRateBps(global.includedGrokComposerBps),
    onDemandBps: assertRateBps(global.onDemandBps),
    dailyHostingPence: assertHostingPence(global.dailyHostingPence),
  }
  if (override === null) return resolved
  if (override.includedPremiumBps !== null) resolved.includedPremiumBps = assertRateBps(override.includedPremiumBps)
  if (override.includedGrokComposerBps !== null) resolved.includedGrokComposerBps = assertRateBps(override.includedGrokComposerBps)
  if (override.onDemandBps !== null) resolved.onDemandBps = assertRateBps(override.onDemandBps)
  if (override.dailyHostingPence !== null) resolved.dailyHostingPence = assertHostingPence(override.dailyHostingPence)
  return resolved
}
