import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHARGE_RULE_VERSION, chargeUnits, decimalUnits, roundRatio, unitsText } from './money'
import {
  ABSENT_CALCULATION_REVISION,
  DEFAULT_CALCULATION_RATES,
  parseCalculationRates,
  parseIsoDate,
  parsePercentageBps,
  parsePoundsToPence,
  parseProjectCalculationOverrides,
  resolveCalculationRates,
  type ProjectCalculationOverrides,
} from './calculation-settings'
import { loadCalculationSettings, type CalculationSettingsDb, type GlobalCalculationSettingsRow, type ProjectCalculationSettingsRow } from './calculation-settings-load'

const legacy = { billable: true, includedBaseBps: 6000, markupBps: 1000, infrastructureMarkupBps: 2500 }
const nominal = decimalUnits('10')
const cash = decimalUnits('4')

test('absent rates keep premium at 50 percent, Grok and Composer at 0, and on-demand cash at face value', () => {
  assert.equal(CHARGE_RULE_VERSION, 'mpdee-global-client-charge-v2')
  assert.deepEqual(DEFAULT_CALCULATION_RATES, { includedPremiumBps: 5000, includedGrokComposerBps: 0, onDemandBps: 10000, dailyHostingPence: 0 })
  assert.equal(unitsText(chargeUnits({ provider: 'cursor', funding: 'included', nominal, cash: BigInt(0), model: 'claude-4.6-sonnet' }, legacy)!), '5.0000000')
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'included', nominal, cash: BigInt(0), model: 'grok-4' }, legacy), BigInt(0))
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'included', nominal, cash: BigInt(0), model: 'composer-2' }, legacy), BigInt(0))
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'on-demand', nominal, cash, model: 'grok-4' }, legacy), cash)
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'on-demand', nominal, cash: decimalUnits('-1.25'), model: 'claude-4.6-sonnet' }, legacy), decimalUnits('-1.25'))
  assert.equal(chargeUnits({ provider: 'vercel', funding: 'infrastructure', nominal: null, cash, model: null }, legacy), cash)
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'free', nominal, cash, model: 'claude-4.6-sonnet' }, legacy), BigInt(0))
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'free-credit', nominal, cash, model: 'claude-4.6-sonnet' }, legacy), BigInt(0))
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'unknown', nominal, cash, model: 'claude-4.6-sonnet' }, legacy), null)
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'included', nominal, cash: BigInt(0), model: 'grok-4' }, { ...legacy, billable: false }), BigInt(0))
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'included', nominal: BigInt(1), cash: BigInt(0), model: 'claude-4.6-sonnet' }, legacy), BigInt(1))
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'included', nominal: BigInt(-1), cash: BigInt(0), model: 'claude-4.6-sonnet' }, legacy), BigInt(-1))
})

test('resolved rates bill included models on nominal and on-demand on cash, including an explicit zero', () => {
  const rates = { includedPremiumBps: 2500, includedGrokComposerBps: 1000, onDemandBps: 8000, dailyHostingPence: 38 }
  const policy = { ...legacy, rates }
  assert.equal(unitsText(chargeUnits({ provider: 'cursor', funding: 'included', nominal, cash, model: 'claude-4.6-sonnet' }, policy)!), '2.5000000')
  assert.equal(unitsText(chargeUnits({ provider: 'cursor', funding: 'included', nominal, cash, model: 'cursor-grok-4' }, policy)!), '1.0000000')
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'on-demand', nominal, cash, model: 'cursor-composer-2' }, policy), roundRatio(cash * BigInt(8000), BigInt(10000)))
  assert.equal(chargeUnits({ provider: 'vercel', funding: 'on-demand', nominal: null, cash: decimalUnits('-1.25'), model: null }, policy), roundRatio(decimalUnits('-1.25') * BigInt(8000), BigInt(10000)))
  assert.equal(chargeUnits({ provider: 'vercel', funding: 'infrastructure', nominal: null, cash, model: null }, policy), cash)
  const zeroOnDemand = { ...policy, rates: { ...rates, onDemandBps: 0, includedGrokComposerBps: 0 } }
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'on-demand', nominal, cash, model: 'gpt-5' }, zeroOnDemand), BigInt(0))
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'included', nominal, cash, model: 'grok-4' }, zeroOnDemand), BigInt(0))
  assert.throws(() => chargeUnits({ provider: 'cursor', funding: 'on-demand', nominal, cash, model: 'gpt-5' }, { ...legacy, rates: { ...rates, onDemandBps: Number.NaN } }))
})

test('parsers reject coercion and accept only strict percentages, pounds, and round-trip dates', () => {
  assert.equal(parsePercentageBps('0'), 0)
  assert.equal(parsePercentageBps('50'), 5000)
  assert.equal(parsePercentageBps('50.5'), 5050)
  assert.equal(parsePercentageBps('1000'), 100_000)
  assert.equal(parsePercentageBps('1000.00'), 100_000)
  assert.equal(parsePoundsToPence('0'), 0)
  assert.equal(parsePoundsToPence('0.01'), 1)
  assert.equal(parsePoundsToPence('100000'), 10_000_000)
  assert.equal(parsePoundsToPence('100000.00'), 10_000_000)
  assert.equal(parseIsoDate('2024-02-29'), '2024-02-29')
  for (const value of ['NaN', 'Infinity', '1e2', '50%', '+50', ' 50', '', '050', '50.555', '-1', '1000.01', '1001', '1000.001']) {
    assert.throws(() => parsePercentageBps(value), /Invalid percentage/, value)
  }
  for (const value of [50, null, undefined, true, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => parsePercentageBps(value), /Invalid percentage/)
  }
  for (const value of ['100000.01', '1e2', '-0.01', '100000.001', '', ' 1']) {
    assert.throws(() => parsePoundsToPence(value), /Invalid pounds amount/, value)
  }
  assert.throws(() => parsePoundsToPence(1), /Invalid pounds amount/)
  for (const value of ['2023-02-29', '2024-02-30', '2024-13-01', '2024-02-29T00:00:00.000Z', '20240229', '']) {
    assert.throws(() => parseIsoDate(value), /Invalid ISO date/, value)
  }
  assert.throws(() => parseCalculationRates({ includedGrokComposerBps: '0', onDemandBps: '100', dailyHostingPence: '0' }), /Invalid calculation settings/)
  assert.deepEqual(parseCalculationRates({ includedPremiumBps: '50', includedGrokComposerBps: '0', onDemandBps: '100', dailyHostingPence: '0' }), DEFAULT_CALCULATION_RATES)
  const parsed = parseProjectCalculationOverrides({
    includedPremiumBps: null, includedGrokComposerBps: '0', onDemandBps: null, dailyHostingPence: '0',
    hostingEnabled: true, hostingStartDate: '2026-01-01', hostingEndDate: null,
  })
  assert.equal(parsed.includedGrokComposerBps, 0)
  assert.equal(parsed.dailyHostingPence, 0)
  assert.equal(parsed.includedPremiumBps, null)
  assert.throws(() => parseProjectCalculationOverrides({
    includedPremiumBps: null, includedGrokComposerBps: null, onDemandBps: null, dailyHostingPence: null,
    hostingEnabled: true, hostingStartDate: null, hostingEndDate: null,
  }), /Hosting enabled requires a start date/)
  assert.throws(() => parseProjectCalculationOverrides({
    includedPremiumBps: null, includedGrokComposerBps: null, onDemandBps: null, dailyHostingPence: null,
    hostingEnabled: false, hostingStartDate: '2026-02-02', hostingEndDate: '2026-02-01',
  }), /before start date/)
  assert.throws(() => parseProjectCalculationOverrides({
    includedPremiumBps: null, includedGrokComposerBps: null, onDemandBps: null, dailyHostingPence: '0',
    hostingEnabled: 'true', hostingStartDate: '2026-01-01', hostingEndDate: null,
  }), /Invalid calculation settings/)
})

test('null inherits, zero overrides, and untouched fields follow a changed global', () => {
  const global = { includedPremiumBps: 7000, includedGrokComposerBps: 250, onDemandBps: 9000, dailyHostingPence: 125 }
  const override: ProjectCalculationOverrides = {
    includedPremiumBps: null, includedGrokComposerBps: 0, onDemandBps: null, dailyHostingPence: 0,
    hostingEnabled: false, hostingStartDate: null, hostingEndDate: null,
  }
  assert.deepEqual(resolveCalculationRates(global, null), global)
  assert.deepEqual(resolveCalculationRates(global, override), { includedPremiumBps: 7000, includedGrokComposerBps: 0, onDemandBps: 9000, dailyHostingPence: 0 })
  assert.throws(() => resolveCalculationRates({ ...global, includedPremiumBps: 1.5 }, null))
})

function db(globalRow: GlobalCalculationSettingsRow | null, projects: ProjectCalculationSettingsRow[], fail?: 'global' | 'projects') {
  const calls = { global: 0, projects: 0 }
  const source: CalculationSettingsDb = {
    costCalculationSettings: { findUnique: async () => { calls.global += 1; if (fail === 'global') throw new Error('db down'); return globalRow } },
    costProjectCalculationSettings: { findMany: async () => { calls.projects += 1; if (fail === 'projects') throw new Error('db down'); return projects } },
  }
  return { source, calls }
}

test('loader resolves one snapshot, keeps absent revisions, and does not mask database errors', async () => {
  const empty = db(null, [])
  const absent = await loadCalculationSettings(empty.source)
  assert.deepEqual(absent.global, DEFAULT_CALCULATION_RATES)
  assert.equal(absent.globalRevision, ABSENT_CALCULATION_REVISION)
  assert.equal(absent.projects.size, 0)
  const missing = absent.resolve('project-a')
  assert.equal(missing.revision, ABSENT_CALCULATION_REVISION)
  assert.equal(missing.schedule.hostingEnabled, false)
  assert.deepEqual(missing.rates, DEFAULT_CALCULATION_RATES)
  absent.resolve('project-b')
  assert.deepEqual(empty.calls, { global: 1, projects: 1 })

  const updated = new Date('2026-10-10T12:00:00.000Z')
  const stored = db({
    id: 'global', includedPremiumBps: 7000, includedGrokComposerBps: 250, onDemandBps: 9000, dailyHostingPence: 125, updatedAt: updated,
  }, [{
    projectId: 'project-a', includedPremiumBps: null, includedGrokComposerBps: 0, onDemandBps: null, dailyHostingPence: 0,
    hostingEnabled: true, hostingStartDate: new Date('2026-01-01T00:00:00.000Z'), hostingEndDate: null, updatedAt: updated,
  }])
  const loaded = await loadCalculationSettings(stored.source)
  assert.equal(loaded.globalRevision, '2026-10-10T12:00:00.000Z')
  assert.equal(loaded.resolve('project-a').rates.includedPremiumBps, 7000)
  assert.equal(loaded.resolve('project-a').rates.includedGrokComposerBps, 0)
  assert.equal(loaded.resolve('project-a').rates.dailyHostingPence, 0)
  assert.equal(loaded.resolve('project-a').schedule.hostingStartDate, '2026-01-01')
  assert.equal(loaded.projectRevisions.get('project-a'), '2026-10-10T12:00:00.000Z')
  assert.equal(loaded.resolve('missing').revision, ABSENT_CALCULATION_REVISION)
  assert.deepEqual(stored.calls, { global: 1, projects: 1 })

  const broken = db(null, [], 'projects')
  await assert.rejects(loadCalculationSettings(broken.source), /db down/)
  await assert.rejects(loadCalculationSettings(db({
    id: 'global', includedPremiumBps: -1, includedGrokComposerBps: 0, onDemandBps: 10000, dailyHostingPence: 0, updatedAt: updated,
  }, []).source), /Invalid percentage/)
})
