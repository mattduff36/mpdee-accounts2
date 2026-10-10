import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_CALCULATION_RATES, type CalculationRates, type HostingSchedule } from './calculation-settings'
import { dailyHostingFeeId, dailyHostingFees, hostingConfigRevision } from './daily-hosting'

const rates = (dailyHostingPence: number): CalculationRates => ({ ...DEFAULT_CALCULATION_RATES, dailyHostingPence })
const schedule = (patch: Partial<HostingSchedule> = {}): HostingSchedule => ({
  hostingEnabled: true, hostingStartDate: '2026-01-01', hostingEndDate: '2026-01-10', ...patch,
})

test('daily hosting fees are inclusive UTC days clipped by the schedule, report window, as-of, and today', () => {
  const fees = dailyHostingFees('project-a', rates(38), schedule(), { from: '2026-01-01', to: '2026-01-20', asOf: '2026-01-04', today: '2026-01-08' })
  assert.deepEqual(fees.map(fee => fee.date), ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'])
  assert.equal(fees[0].amountPence, 38)
  assert.equal(fees[0].currency, 'GBP')
  assert.equal(fees[0].category, 'VERCEL_HOSTING')
  assert.equal(fees[0].funding, 'infrastructure')
  assert.equal(fees[0].providerCash, false)
  assert.equal(fees[0].label, 'Daily hosting fee')
  assert.equal(fees[0].id, 'internal:daily-hosting:project-a:2026-01-01')
  assert.equal(fees[0].id.includes('vercel:membership'), false)
  assert.equal(fees[0].configRevision, hostingConfigRevision('project-a', 38, schedule()))
  const open = dailyHostingFees('project-a', rates(38), schedule({ hostingStartDate: '2024-02-28', hostingEndDate: null }), { from: '2024-02-28', to: '2024-03-01', today: '2026-01-01' })
  assert.deepEqual(open.map(fee => fee.date), ['2024-02-28', '2024-02-29', '2024-03-01'])
  const single = dailyHostingFees('project-a', rates(38), schedule({ hostingEndDate: '2026-01-01' }), { from: '2026-01-01', to: '2026-01-01', today: '2026-01-01' })
  assert.deepEqual(single.map(fee => fee.date), ['2026-01-01'])
  const outside = dailyHostingFees('project-a', rates(38), schedule(), { from: '2026-02-01', to: '2026-02-02', today: '2026-03-01' })
  assert.deepEqual(outside, [])
  const future = dailyHostingFees('project-a', rates(38), schedule({ hostingStartDate: '2026-12-01', hostingEndDate: null }), { from: '2026-10-01', today: '2026-10-10' })
  assert.deepEqual(future, [])
})

test('disabled and explicit zero hosting emit no fees, while reversed or huge windows fail closed', () => {
  const enabled = schedule()
  assert.deepEqual(dailyHostingFees('project-a', rates(0), enabled, { from: '2026-01-01', to: '2026-01-03', today: '2026-01-10' }), [])
  assert.deepEqual(dailyHostingFees('project-a', rates(38), { ...enabled, hostingEnabled: false }, { from: '2026-01-01', to: '2026-01-03', today: '2026-01-10' }), [])
  assert.equal(hostingConfigRevision('project-a', 0, enabled).includes(':0:'), true)
  assert.notEqual(dailyHostingFeeId('project-a', '2026-01-01'), dailyHostingFeeId('project-b', '2026-01-01'))
  assert.throws(() => dailyHostingFees('project-a', rates(38), enabled, { from: '2026-01-05', to: '2026-01-04', today: '2026-01-10' }), /Reversed report window/)
  assert.throws(() => dailyHostingFees('project-a', rates(0), enabled, { from: '2026-01-05', to: '2026-01-04', today: '2026-01-10' }), /Reversed report window/)
  assert.throws(() => dailyHostingFees('project-a', rates(38), schedule({ hostingStartDate: '1000-01-01', hostingEndDate: null }), { from: '1000-01-01', today: '9999-12-31' }), /exceeds cap/)
  assert.throws(() => dailyHostingFees('project-a', rates(38), { hostingEnabled: true, hostingStartDate: null, hostingEndDate: null }, { from: '2026-01-01', today: '2026-01-02' }), /requires a start date/)
  assert.throws(() => dailyHostingFees('vercel:membership', rates(38), enabled, { from: '2026-01-01', today: '2026-01-02' }), /Invalid project/)
})
