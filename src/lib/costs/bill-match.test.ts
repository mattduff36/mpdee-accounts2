import assert from 'node:assert/strict'
import test from 'node:test'
import { allocationConserves, matchProviderBills, type BillUsage, type ProviderBill } from './bill-match'

const usage = (patch: Partial<BillUsage>): BillUsage => ({
  id: 'event-1', provider: 'cursor', accountRef: 'acct-a', funding: 'on-demand', occurredAt: '2026-09-10T12:00:00.000Z',
  projectId: 'itrader', nominalUnits: BigInt(100), providerUnits: BigInt(80), quality: 'complete', currency: 'USD', ...patch,
})

test('an on-demand bill suppresses only usage in the same account, service and period', () => {
  const bills: ProviderBill[] = [
    { id: 'od', provider: 'cursor', accountRef: 'acct-a', service: 'on-demand', periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-10-01T00:00:00.000Z', netPence: 60422 },
    { id: 'other', provider: 'cursor', accountRef: 'acct-b', service: 'on-demand', periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-10-01T00:00:00.000Z', netPence: 100 },
  ]
  const result = matchProviderBills(bills, [usage({}), usage({ id: 'elsewhere', accountRef: 'acct-b', occurredAt: '2026-08-01T00:00:00.000Z' })])
  assert.deepEqual(result.suppressedEventIds, ['event-1'])
  assert.equal(result.unallocated.find(row => row.billId === 'other')?.pence, 100)
  assert.equal(allocationConserves(bills, result), true)
})

test('a subscription bill is overhead and does not suppress included usage; a missing account is not allocated', () => {
  const bills: ProviderBill[] = [
    { id: 'sub', provider: 'cursor', accountRef: 'acct-a', service: 'subscription', periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-10-01T00:00:00.000Z', netPence: 100 },
    { id: 'bare', provider: 'cursor', accountRef: null, service: 'subscription', periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-10-01T00:00:00.000Z', netPence: 50 },
    { id: 'day', provider: 'vercel', accountRef: 'acct-a', service: 'membership', periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-09-02T00:00:00.000Z', netPence: 38 },
  ]
  const result = matchProviderBills(bills, [usage({ id: 'included', funding: 'included', providerUnits: BigInt(0), nominalUnits: BigInt(40) })])
  assert.deepEqual(result.suppressedEventIds, [])
  assert.equal(result.allocations.find(row => row.billId === 'sub')?.pence, 100)
  assert.equal(result.unallocated.find(row => row.billId === 'bare')?.pence, 50)
  assert.equal(result.retainedOverheadPence, 38)
  assert.equal(allocationConserves(bills, result), true)
})
