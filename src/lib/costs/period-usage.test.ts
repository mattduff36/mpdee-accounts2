import test from 'node:test'
import assert from 'node:assert/strict'
import { combineGbp, mergeMoney, parseInclusivePeriod, summarisePeriodUsage, type PeriodEventMeasure } from './period-usage'

const row = (patch: Partial<PeriodEventMeasure>): PeriodEventMeasure => ({
  projectId: 'project', currency: 'USD', nominal: null, confirmed: null, charge: null, ...patch,
})

test('a period is inclusive and rejects a reversed or oversized range', () => {
  const same = parseInclusivePeriod('2026-10-02', '2026-10-02', '2026-10-14')
  assert.equal(same.ok, true)
  if (same.ok) {
    assert.equal(same.period.start.toISOString(), '2026-10-02T00:00:00.000Z')
    assert.equal(same.period.endExclusive.toISOString(), '2026-10-03T00:00:00.000Z')
  }
  const fallback = parseInclusivePeriod(undefined, undefined, '2026-10-14')
  assert.equal(fallback.ok && fallback.period.from, '2026-10-01')
  assert.equal(fallback.ok && fallback.period.to, '2026-10-14')
  assert.equal(parseInclusivePeriod('2026-10-14', '2026-10-01', '2026-10-14').ok, false)
  assert.equal(parseInclusivePeriod('2026-02-31', '2026-03-01', '2026-10-14').ok, false)
  assert.equal(parseInclusivePeriod('2024-01-01', '2026-10-14', '2026-10-14').ok, false)
})

test('included usage stays out of confirmed cash and a held charge stays out of the estimate', () => {
  const projects = summarisePeriodUsage([
    row({ nominal: { units: BigInt(10), gbp: BigInt(8) }, charge: { units: BigInt(5), gbp: BigInt(4) } }),
    row({ nominal: { units: BigInt(4), gbp: null }, confirmed: { units: BigInt(4), gbp: null } }),
    row({ projectId: 'other', currency: 'GBP', confirmed: { units: BigInt(3), gbp: BigInt(3) }, charge: { units: BigInt(3), gbp: BigInt(3) } }),
    row({ nominal: { units: null, gbp: null } }),
  ])
  const project = projects.get('project')
  assert.equal(project?.events, 3)
  assert.equal(project?.held, 2)
  assert.equal(project?.nominal[0].units, BigInt(14))
  assert.equal(project?.nominal[0].missing, 1)
  assert.equal(project?.confirmed[0].units, BigInt(4))
  assert.equal(project?.confirmedGbp.missing, 1)
  assert.equal(project?.charge[0].units, BigInt(5))
  assert.equal(projects.get('other')?.confirmed[0].currency, 'GBP')
  const gbp = combineGbp([project!.nominalGbp, projects.get('other')!.confirmedGbp])
  assert.equal(gbp.units, BigInt(11))
  assert.equal(gbp.known, 2)
  assert.equal(gbp.missing, 2)
  assert.deepEqual(mergeMoney([project!.nominal, projects.get('other')!.confirmed]).map(item => item.currency), ['GBP', 'USD'])
})
