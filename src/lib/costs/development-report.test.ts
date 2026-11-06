import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDevelopmentReport, developmentEventQuery, developmentPeriod, londonMidnight, parseDevelopmentQuery, type DevelopmentEvent } from './development-report'
import { loadDevelopmentReport } from './development-load'
import { decimalUnits } from './money'

const query = parseDevelopmentQuery({ from: '2026-10-01', to: '2026-11-01' })
function event(id: string, recordClass: 'provider-daily-aggregate' | 'task-measurement' = 'task-measurement', changes: Partial<DevelopmentEvent> = {}): DevelopmentEvent {
  return {
    id, provider: 'codex', accountRef: 'private-account', sourceKey: `${id}:0`, projectId: 'project-1',
    occurredAt: new Date('2026-10-12T12:00:00Z'),
    revisions: [{
      revision: 1, nominalUnits: decimalUnits('10'), providerUnits: null, currency: 'USD', fxGbp: null, funding: 'unknown',
      evidence: { prompt: 'PRIVATE RAW CONTENT', workspaceRef: 'private-path', development: {
        recordClass, workItemId: 'work-1', parentChatId: 'chat-1', taskId: 'task-1', attempt: 1,
        coverage: 'complete', observedAt: '2026-11-05T12:00:00Z', funding: 'unknown',
      } },
    }],
    ...changes,
  }
}

test('overlapping provider and task evidence stay in separate totals; task cash never becomes actual cost', () => {
  const task = event('task')
  task.revisions[0].providerUnits = decimalUnits('7')
  const report = buildDevelopmentReport([event('daily', 'provider-daily-aggregate'), task], query)
  assert.equal(report.providerDailyAggregates.totals[0].reportedValue?.amount, '10.0000000')
  assert.equal(report.taskMeasurements.totals[0].estimatedValue?.amount, '10.0000000')
  assert.equal(report.providerDailyAggregates.totals[0].evidencedCash?.amount, null)
  assert.equal('evidencedCash' in report.taskMeasurements.totals[0], false)
  assert.equal('total' in report, false)
  assert.equal(report.taskMeasurements.groups[0].period, '2026-10-12')
  const output = JSON.stringify(report)
  for (const secret of ['PRIVATE RAW CONTENT', 'private-path', 'private-account', 'chat-1', 'task-1', '"evidence":']) assert.equal(output.includes(secret), false, secret)
})

test('latest revisions and source identity once, independent of row order; accounts/providers remain distinct', () => {
  const older = event('same')
  const newer = event('same')
  newer.revisions = [{ ...newer.revisions[0], revision: 2, nominalUnits: decimalUnits('3') }, older.revisions[0]]
  for (const rows of [[older, newer, newer], [newer, older, newer]]) {
    const report = buildDevelopmentReport(rows, query)
    assert.equal(report.records, 1)
    assert.equal(report.taskMeasurements.totals[0].estimatedValue?.amount, '3.0000000')
  }
  const report = buildDevelopmentReport([older, { ...older, provider: 'openai' }, { ...older, accountRef: 'other' }], query)
  assert.equal(report.records, 3)
  assert.equal(report.taskMeasurements.totals.length, 2)
})

test('unknown and explicit zero stay distinct, partial subtotals do not pretend to be complete', () => {
  const unknown = event('unknown', 'provider-daily-aggregate')
  unknown.revisions[0].nominalUnits = null
  const zero = event('zero', 'provider-daily-aggregate')
  zero.revisions[0].nominalUnits = BigInt(0)
  zero.revisions[0].providerUnits = BigInt(0)
  const one = buildDevelopmentReport([zero], query).providerDailyAggregates.totals[0]
  assert.equal(one.reportedValue?.amount, '0.0000000')
  assert.equal(one.evidencedCash?.amount, '0.0000000')
  assert.equal(one.evidencedCashGbp?.amount, null, 'even zero foreign cash needs recorded FX for a GBP display')
  const combined = buildDevelopmentReport([unknown, zero], query).providerDailyAggregates.totals[0]
  assert.deepEqual(combined.evidencedCash, { amount: null, knownAmount: '0.0000000', known: 1, unknown: 1 })
  assert.equal(combined.funding.unknown, 2)
  assert.equal(combined.coverage.complete, 2)
})

test('project and explicit unassigned, source date window, currencies and recorded FX stay independent', () => {
  const assigned = event('assigned')
  assigned.revisions[0].fxGbp = { toString: () => '0.8' }
  const unassigned = event('unassigned', 'task-measurement', { projectId: null })
  unassigned.revisions[0].currency = 'EUR'
  const gbp = event('gbp')
  gbp.revisions[0].currency = 'GBP'
  const outside = event('outside', 'task-measurement', { occurredAt: new Date('2026-11-01T00:00:00Z') })
  const start = event('start', 'task-measurement', { occurredAt: new Date('2026-10-01T00:00:00Z') })
  const report = buildDevelopmentReport([assigned, unassigned, gbp, outside, start], query)
  assert.equal(report.records, 4)
  assert.equal(report.taskMeasurements.totals.length, 3)
  assert.equal(report.taskMeasurements.groups.find(row => row.currency === 'EUR')?.assignment, 'unassigned')
  assert.equal(report.taskMeasurements.groups.find(row => row.currency === 'GBP')?.estimatedGbp?.amount, '10.0000000')
  assert.equal(report.taskMeasurements.groups.find(row => row.period === '2026-10-12' && row.currency === 'USD')?.estimatedGbp?.amount, '8.0000000')
  assert.equal(buildDevelopmentReport([assigned, unassigned], { ...query, projectId: 'unassigned' }).records, 1)
  assert.equal(buildDevelopmentReport([assigned, unassigned], { ...query, projectId: 'project-1' }).records, 1)
})

test('exact exclusive ISO dates, 366 day maximum, deterministic defaults and strict parameters', () => {
  assert.doesNotThrow(() => parseDevelopmentQuery({ from: '2024-01-01', to: '2025-01-01' }))
  for (const input of [
    { from: '2024-01-01', to: '2025-01-02' }, { from: '2026-02-30', to: '2026-03-01' },
    { from: '2026-01-01', to: '2026-01-01' }, { from: '2026-02-01', to: '2026-01-01' },
    { from: '2026-01-01T00:00:00Z', to: '2026-02-01' }, { from: ['2026-01-01'], to: '2026-02-01' },
    { ...query, extra: 'no' }, { ...query, projectId: '../../secret' }, { ...query, groupBy: 'year' },
  ]) assert.throws(() => parseDevelopmentQuery(input))
  const defaults = parseDevelopmentQuery({ projectId: '' }, new Date('2026-11-06T19:00:00Z'))
  assert.equal(defaults.from, '2026-10-08')
  assert.equal(defaults.to, '2026-11-07')
  assert.equal(defaults.projectId, undefined)
})

test('UK Monday weeks, calendar months and DST use source dates', () => {
  assert.equal(developmentPeriod(new Date('2026-10-04T23:30:00Z'), 'week'), '2026-10-05')
  assert.equal(developmentPeriod(new Date('2026-10-25T23:30:00Z'), 'week'), '2026-10-19')
  assert.equal(developmentPeriod(new Date('2026-09-30T23:30:00Z'), 'month'), '2026-10')
})

test('UK selected day includes its BST midnight hour and excludes the next one', () => {
  const selection = parseDevelopmentQuery({ from: '2026-07-01', to: '2026-07-02' })
  const included = event('included', 'task-measurement', { occurredAt: new Date('2026-06-30T23:30:00Z') })
  const excluded = event('excluded', 'task-measurement', { occurredAt: new Date('2026-07-01T23:30:00Z') })
  assert.equal(buildDevelopmentReport([included, excluded], selection).records, 1)
  assert.equal(developmentEventQuery(selection).where.occurredAt.gte.toISOString(), '2026-06-30T23:00:00.000Z')
  assert.equal(londonMidnight('2026-03-29').toISOString(), '2026-03-29T00:00:00.000Z')
  assert.equal(londonMidnight('2026-10-25').toISOString(), '2026-10-24T23:00:00.000Z')
  assert.equal(parseDevelopmentQuery({}, new Date('2026-06-30T23:30:00Z')).to, '2026-07-02')
})

test('source observation range remains visible per report bucket', () => {
  const first = event('first'), last = event('last')
  ;(last.revisions[0].evidence as any).development.observedAt = '2026-11-06T12:00:00Z'
  const row = buildDevelopmentReport([first, last], query).taskMeasurements.totals[0]
  assert.equal(row.observedFrom, '2026-11-05T12:00:00.000Z')
  assert.equal(row.observedThrough, '2026-11-06T12:00:00.000Z')
})

test('recorded Decimal FX supports scientific notation without inventing or rounding a rate', () => {
  const row = event('fx')
  row.revisions[0].fxGbp = { toString: () => '1e-8' }
  assert.equal(buildDevelopmentReport([row], query).taskMeasurements.totals[0].estimatedGbp.amount, '0.0000001')
  for (const rate of ['0', '-1', '101', '1e-9', 'not-a-rate']) {
    row.revisions[0].fxGbp = { toString: () => rate }
    assert.throws(() => buildDevelopmentReport([row], query), /Invalid recorded development FX/)
  }
})

test('bounded loader uses latest revisions, provider and date/project predicates, and rejects overflow', async () => {
  const expected = developmentEventQuery({ ...query, projectId: 'unassigned' })
  assert.deepEqual(expected.where.provider, { in: ['openai', 'codex'] })
  assert.equal(expected.where.projectId, null)
  assert.equal(expected.where.occurredAt.lt.toISOString(), '2026-11-01T00:00:00.000Z')
  assert.equal(expected.select.revisions.take, 1)
  assert.deepEqual(expected.select.revisions.orderBy, { revision: 'desc' })
  assert.equal(expected.take, 50_001)
  await assert.rejects(loadDevelopmentReport(query, async args => {
    assert.equal(args.take, 50_001)
    return Array<DevelopmentEvent>(50_001).fill(event('overflow'))
  }), /exceeds 50000/)
  const bad = event('bad')
  bad.revisions[0].evidence = {}
  assert.throws(() => buildDevelopmentReport([bad], query), /invalid metadata/)
  assert.throws(() => buildDevelopmentReport([{ ...bad, revisions: [] }], query), /missing its monetary revision/)
})
