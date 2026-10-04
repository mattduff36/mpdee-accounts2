import assert from 'node:assert/strict'
import test from 'node:test'
import { adjustChargeSnapshot, freezeChargeSnapshot, replayChargeSnapshot, type ChargeSnapshotInput } from './charge-snapshot'
import { COMPARISON_POLICY_VERSION } from './comparison-policy'

const input = (patch: Partial<ChargeSnapshotInput> = {}): ChargeSnapshotInput => ({
  projectId: 'itrader', policyVersion: COMPARISON_POLICY_VERSION, allocationMethod: null, sourceRevisionIds: ['rev-b', 'rev-a'],
  currency: 'GBP', fxSource: 'identity', fxDate: '2026-09-01', fxRate: '1', usageValueUnits: null, providerCostUnits: null,
  clientChargePence: 4200, outstandingPence: 3000, invoiceId: 'inv-1', paymentId: 'pay-1', replacesSnapshotId: null,
  evidence: { settlementId: 'set-1' }, ...patch,
})

test('an approved snapshot keeps its settlement link and a replay adds nothing', () => {
  const frozen = freezeChargeSnapshot(input())
  assert.equal(frozen.verificationStatus, 'approved')
  assert.equal(frozen.paymentId, 'pay-1')
  assert.equal(frozen.invoiceId, 'inv-1')
  assert.deepEqual(frozen.sourceRevisionIds, ['rev-a', 'rev-b'])
  assert.equal(replayChargeSnapshot([frozen.id], freezeChargeSnapshot(input())).added, 0)
  assert.equal(replayChargeSnapshot([], frozen).added, 1)
})

test('a correction is a new snapshot and the approved row is unchanged', () => {
  const frozen = freezeChargeSnapshot(input())
  const adjusted = adjustChargeSnapshot(frozen.id, input({ clientChargePence: 4100, replacesSnapshotId: frozen.id, evidence: { reason: 'client credit' } }))
  assert.notEqual(adjusted.id, frozen.id)
  assert.equal(adjusted.replacesSnapshotId, frozen.id)
  assert.equal(frozen.clientChargePence, 4200)
  assert.equal(frozen.paymentId, 'pay-1')
  assert.throws(() => adjustChargeSnapshot(frozen.id, input()))
})
