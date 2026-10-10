import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateCostReport, type CostReportRow } from './report-aggregation'

const rows: CostReportRow[] = [
  { date: '2026-04-02', projectId: 'a', projectName: 'Alpha', conversationId: 'chat-a', taskTopics: ['Costs and accounting'], provider: 'cursor', funding: 'included', nominal: BigInt(1000), providerCash: BigInt(0), estimate: BigInt(500), held: false },
  { date: '2026-04-02', projectId: 'a', projectName: 'Alpha', conversationId: 'chat-a', provider: 'cursor', funding: 'on_demand', nominal: BigInt(800), providerCash: BigInt(300), estimate: BigInt(330), held: false },
  { date: '2026-04-03', projectId: 'b', projectName: 'Beta', provider: 'vercel', funding: null, nominal: null, providerCash: BigInt(900), estimate: null, held: true },
  { date: '2026-04-03', projectId: null, projectName: 'Unassigned', provider: 'cursor', funding: 'included', nominal: BigInt(400), providerCash: null, estimate: BigInt(200), held: true },
]

test('aggregates daily actual cash separately from nominal and client estimates', () => {
  const report = aggregateCostReport(rows)
  assert.deepEqual(report.totals, { nominal: BigInt(2200), nominalKnown: 3, providerCash: BigInt(1200), providerCashKnown: 3, estimate: BigInt(1030), estimateKnown: 3, held: 2, events: 4 })
  assert.equal(report.daily.length, 2)
  assert.deepEqual(report.daily[0], { date: '2026-04-02', events: 2, held: 0, nominal: BigInt(1800), nominalKnown: 2, providerCash: BigInt(300), providerCashKnown: 2, estimate: BigInt(830), estimateKnown: 2, hostingFee: false, included: BigInt(500), onDemand: BigInt(330), infrastructure: BigInt(0) })
  assert.deepEqual(report.composition.map(x => [x.label, x.value]), [['Included usage estimate', BigInt(700)], ['On-demand estimate', BigInt(330)]])
  assert.deepEqual(report.chats.map(chat => ({ date: chat.date, projectId: chat.projectId, projectName: chat.projectName, conversationId: chat.conversationId, estimate: chat.estimate, cash: chat.cash, cashKnown: chat.cashKnown, events: chat.events, taskTopics: chat.taskTopics })), [{ date: '2026-04-02', projectId: 'a', projectName: 'Alpha', conversationId: 'chat-a', estimate: BigInt(830), cash: BigInt(300), cashKnown: 2, events: 2, taskTopics: ['Costs and accounting'] }])
})

test('chat identity includes its project and unknown provider cash stays unavailable', () => {
  const report = aggregateCostReport([
    { date: '2026-04-02', projectId: 'a', projectName: 'Alpha', conversationId: 'same-id', provider: 'cursor', funding: 'included', nominal: null, providerCash: null, estimate: BigInt(300), held: false },
    { date: '2026-04-02', projectId: 'a', projectName: 'Alpha', conversationId: 'same-id', provider: 'cursor', funding: null, nominal: null, providerCash: BigInt(100), estimate: null, held: true },
    { date: '2026-04-02', projectId: 'b', projectName: 'Beta', conversationId: 'same-id', provider: 'cursor', funding: 'included', nominal: null, providerCash: null, estimate: BigInt(200), held: false },
  ])
  assert.equal(report.chats.length, 2)
  assert.deepEqual(report.chats.map(chat => [chat.projectId, chat.projectName, chat.estimate, chat.estimateKnown, chat.cash, chat.cashKnown, chat.events]), [['a', 'Alpha', BigInt(300), 1, BigInt(100), 1, 2], ['b', 'Beta', BigInt(200), 1, null, 0, 1]])
})

test('daily provider cash is net of credits before ranking', () => {
  const report = aggregateCostReport([
    { date: '2026-04-02', projectId: 'a', projectName: 'Alpha', provider: 'vercel', funding: null, nominal: null, providerCash: BigInt(900), estimate: BigInt(990), held: false },
    { date: '2026-04-02', projectId: 'a', projectName: 'Alpha', provider: 'vercel', funding: null, nominal: null, providerCash: BigInt(-1100), estimate: BigInt(-1210), held: false },
  ])
  assert.equal(report.daily[0].providerCash, BigInt(-200))
  assert.equal(report.daily[0].estimate, BigInt(-220))
  assert.equal(report.daily[0].hostingFee, false)
})

test('fee-only days and projects add each hosting fee once and leave source counts at zero', () => {
  const report = aggregateCostReport([], [
    { date: '2026-04-04', projectId: 'p', projectName: 'Portal', amountPence: 38 },
    { date: '2026-04-04', projectId: 'q', projectName: 'Queue', amountPence: 12 },
    { date: '2026-04-05', projectId: 'p', projectName: 'Portal', amountPence: 0 },
  ])
  const units = BigInt(50) * BigInt(100000)
  assert.equal(report.daily.length, 1)
  assert.equal(report.daily[0].date, '2026-04-04')
  assert.equal(report.daily[0].hostingFee, true)
  assert.equal(report.daily[0].events, 0)
  assert.equal(report.daily[0].held, 0)
  assert.equal(report.daily[0].estimateKnown, 0)
  assert.equal(report.daily[0].nominalKnown, 0)
  assert.equal(report.daily[0].providerCashKnown, 0)
  assert.equal(report.daily[0].nominal, BigInt(0))
  assert.equal(report.daily[0].providerCash, BigInt(0))
  assert.equal(report.daily[0].estimate, units)
  assert.equal(report.daily[0].infrastructure, units)
  assert.equal(report.daily[0].included, BigInt(0))
  assert.equal(report.daily[0].onDemand, BigInt(0))
  assert.deepEqual(report.totals, { nominal: BigInt(0), nominalKnown: 0, providerCash: BigInt(0), providerCashKnown: 0, estimate: units, estimateKnown: 0, held: 0, events: 0 })
  assert.deepEqual(report.composition, [{ label: 'Infrastructure', value: units }])
  assert.deepEqual(report.hosting.projects.map(project => [project.projectId, project.projectName, project.rows, project.units]), [['p', 'Portal', 1, BigInt(38) * BigInt(100000)], ['q', 'Queue', 1, BigInt(12) * BigInt(100000)]])
  assert.equal(report.hosting.days.length, 1)
  assert.equal(report.hosting.days[0].rows, 2)
  assert.equal(report.chats.length, 0)
})

test('a known hosting fee beside held unknown source keeps imported cash and partial coverage', () => {
  const source: CostReportRow = { date: '2026-04-03', projectId: 'b', projectName: 'Beta', provider: 'vercel', funding: null, nominal: BigInt(400), providerCash: BigInt(900), estimate: null, held: true }
  const without = aggregateCostReport([source])
  const report = aggregateCostReport([source], [{ date: '2026-04-03', projectId: 'fee-only', projectName: 'Fee only', amountPence: 100 }])
  const units = BigInt(100) * BigInt(100000)
  assert.equal(report.daily.length, 1)
  assert.equal(report.daily[0].hostingFee, true)
  assert.equal(report.daily[0].events, without.daily[0].events)
  assert.equal(report.daily[0].estimateKnown, without.daily[0].estimateKnown)
  assert.equal(report.daily[0].nominal, without.daily[0].nominal)
  assert.equal(report.daily[0].nominalKnown, without.daily[0].nominalKnown)
  assert.equal(report.daily[0].providerCash, without.daily[0].providerCash)
  assert.equal(report.daily[0].providerCashKnown, without.daily[0].providerCashKnown)
  assert.equal(report.daily[0].held, 1)
  assert.equal(report.totals.nominal, without.totals.nominal)
  assert.equal(report.totals.nominalKnown, without.totals.nominalKnown)
  assert.equal(report.totals.providerCash, without.totals.providerCash)
  assert.equal(report.totals.providerCashKnown, without.totals.providerCashKnown)
  assert.equal(report.totals.estimateKnown, without.totals.estimateKnown)
  assert.equal(report.totals.events, 1)
  assert.equal(report.totals.estimate, without.totals.estimate + units)
  assert.equal(report.daily[0].estimate, units)
  assert.equal(report.daily[0].infrastructure, units)
  assert.equal(report.daily[0].estimateKnown < report.daily[0].events, true)
  assert.deepEqual(report.composition, [{ label: 'Infrastructure', value: units }])
  assert.deepEqual(report.hosting.projects.map(project => project.projectId), ['fee-only'])
})
