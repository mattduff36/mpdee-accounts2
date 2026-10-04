import assert from 'node:assert/strict'
import test from 'node:test'
import { baselineTimestamp, classifyReportedRecords, explainSourceDelta, HOUR_MS, londonLocalToUtc, NAIVE_PREVIOUS_START, netReversalChain, refuseNaiveTimezoneCorrection, reviewInvoiceCredit, reviewClientAdjustment, type HistoricalSource, type SourceAmount } from './historical-reconcile'
import { LEDGER_START } from './comparison-policy'

const period = { periodStart: '2026-08-13T23:00:00.000Z', periodEnd: '2026-08-14T23:00:00.000Z' }
const record = (patch: Partial<HistoricalSource>): HistoricalSource => ({
  id: 'row', label: 'Adjustment', amountPence: 0, source: 'legacy-client-charge', invoiceId: null, paymentId: null, settlementId: null, ...period, ...patch,
})

test('reported payment, credit and adjustment rows keep their settlement class and are not provider expenses', () => {
  const classified = classifyReportedRecords([
    record({ id: 'pay', label: 'Payment credit', amountPence: 15000, source: 'payment', paymentId: 'pay-1', settlementId: 'set-1' }),
    record({ id: 'work', label: 'Client credit', amountPence: -2500, source: 'legacy-client-charge' }),
    record({ id: 'adjust', label: 'Client adjustment', amountPence: 750, source: 'legacy-client-charge', invoiceId: 'inv-adjust' }),
  ])
  assert.deepEqual(classified.map(row => row.treatment), ['customer-payment', 'client-charge-credit', 'client-charge-adjustment'])
  assert.equal(classified.every(row => row.countsAsProviderExpense === false), true)
  assert.equal(classified[0].settlementLinked, true)
  assert.equal(classified[0].amountPence, 15000)
  assert.equal(classified[1].amountPence, -2500)
  assert.equal(classified[2].periodEnd, period.periodEnd)
  const unresolved = classifyReportedRecords([record({ label: 'Payment credit', amountPence: 15000, source: 'provider-usage' })])
  assert.equal(unresolved[0].treatment, 'unresolved')
  assert.equal(unresolved[0].amountPence, null)
})

test('a reversal chain is deducted once and a same-client invoice is not project linkage', () => {
  const chain = netReversalChain([
    { id: 'charge', kind: 'CHARGE', amountPence: 15000, reversesId: null },
    { id: 'reversal', kind: 'REVERSAL', amountPence: -15000, reversesId: 'charge' },
    { id: 'credit', kind: 'CHARGE', amountPence: -15000, reversesId: null },
  ])
  assert.equal(chain.netPence, -15000)
  assert.deepEqual(chain.currentIds, ['credit'])
  const review = reviewInvoiceCredit({ chain: [
    { id: 'charge', kind: 'CHARGE', amountPence: 15000, reversesId: null },
    { id: 'reversal', kind: 'REVERSAL', amountPence: -15000, reversesId: 'charge' },
    { id: 'credit', kind: 'CHARGE', amountPence: -15000, reversesId: null },
  ], invoice: { amountPence: 15000, sameClient: true, projectLinked: false } })
  assert.equal(review.deductPayment, false)
  assert.equal(review.sameClientIsNotLinkage, true)
  assert.equal(review.countedOnce, true)
  assert.equal(reviewClientAdjustment({ amountPence: 750, usageEvidence: 'unknown' }).status, 'unresolved')
  assert.equal(refuseNaiveTimezoneCorrection('2026-09-01 07:00:00').correction, null)
})

test('source deltas are explained without forcing the totals to agree', () => {
  const accounts: SourceAmount[] = [{ id: 'a', currency: 'USD', units: BigInt(5), projectId: 'itrader', funding: 'included', provider: 'cursor', view: 'client-charge' }]
  const itrader: SourceAmount[] = [
    { id: 'a', currency: 'USD', units: BigInt(6), projectId: 'itrader', funding: 'included', provider: 'cursor', view: 'client-charge' },
    { id: 'b', currency: 'USD', units: BigInt(1), projectId: null, funding: 'on-demand', provider: 'cursor', view: 'provider-cost' },
    { id: 'b', currency: 'USD', units: BigInt(1), projectId: null, funding: 'on-demand', provider: 'cursor', view: 'provider-cost' },
  ]
  const delta = explainSourceDelta(accounts, itrader)
  assert.equal(delta.forcedAgreement, false)
  assert.equal(delta.totals[0].equal, false)
  assert.equal(delta.differences.some(row => row.kind === 'policy' && row.id === 'a'), true)
  assert.equal(delta.differences.some(row => row.kind === 'missing-events' && row.id === 'b'), true)
  assert.equal(delta.differences.some(row => row.kind === 'duplicates' && row.id === 'b'), true)
})

test('a one-hour baseline offset is reported and the exclusive end is not rewritten', () => {
  const shifted = baselineTimestamp('2026-08-14T00:00:00.000Z')
  assert.equal(shifted.oneHourDiscrepancy, true)
  assert.equal(shifted.offsetMs, HOUR_MS)
  assert.equal(shifted.ledgerStart, LEDGER_START)
  assert.equal(baselineTimestamp(LEDGER_START).matchesLedgerStart, true)
  const interpreted = londonLocalToUtc(NAIVE_PREVIOUS_START)
  assert.equal(Date.parse('2026-09-01T07:00:00.000Z') - interpreted.getTime(), HOUR_MS)
  assert.equal(NAIVE_PREVIOUS_START, '2026-09-01 07:00:00')
  assert.equal(period.periodEnd, '2026-08-14T23:00:00.000Z')
})
