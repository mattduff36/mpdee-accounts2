import assert from 'node:assert/strict'
import test from 'node:test'
import { allocateSubscriptionExpense } from './subscription-allocation'
import { ALLOCATION_METHOD } from './comparison-policy'

const included = (projectId: string | null, nominal: bigint) => ({ projectId, funding: 'included', nominalUnits: nominal, providerUnits: BigInt(0), quality: 'complete', currency: 'USD' })

test('subscription allocation conserves pence, keeps unassigned weight, and ignores on-demand cash', () => {
  const result = allocateSubscriptionExpense(100, [
    included('itrader', BigInt(1)),
    included(null, BigInt(1)),
    { projectId: 'itrader', funding: 'on-demand', nominalUnits: BigInt(999), providerUnits: BigInt(50), quality: 'complete', currency: 'USD' },
  ])
  assert.equal(result.method, ALLOCATION_METHOD)
  assert.equal(result.projects.reduce((total, row) => total + row.pence, 0) + result.unassignedPence + result.unallocatedOverheadPence, 100)
  assert.equal(result.projects[0].pence, 50)
  assert.equal(result.unassignedPence, 50)
  assert.equal(result.unallocatedOverheadPence, 0)
  assert.equal(result.zeroProviderCashIncluded, 2)
})

test('a negative subscription credit conserves its sign and zero weights stay overhead', () => {
  const credit = allocateSubscriptionExpense(-90, [included('itrader', BigInt(1)), included('other', BigInt(2))])
  assert.equal(credit.projects.reduce((total, row) => total + row.pence, 0) + credit.unassignedPence + credit.unallocatedOverheadPence, -90)
  const emptyWeight = allocateSubscriptionExpense(38, [included('itrader', BigInt(0))])
  assert.equal(emptyWeight.unallocatedOverheadPence, 38)
  assert.equal(emptyWeight.projects.length, 0)
})
