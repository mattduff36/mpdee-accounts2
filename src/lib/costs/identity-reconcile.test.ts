import assert from 'node:assert/strict'
import test from 'node:test'
import { assignItraderIdentities, explainAccountCoverage, explainStatusOverlap, itraderEventIdentity, itraderGroupKey, reconcileIdentities } from './identity-reconcile'

const fields = {
  accountRef: 'acct-a', timestamp: '2026-09-01T12:00:00.000Z', model: 'composer', conversationId: 'conv-1',
  kind: 'USAGE_EVENT_KIND_INCLUDED_IN_ULTRA', isTokenBasedCall: true, inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0,
}

test('identity matches the iTrader hash and does not assign a missing project to iTrader', () => {
  const [assigned] = assignItraderIdentities([fields])
  assert.equal(assigned.identity, itraderEventIdentity(itraderGroupKey(fields), 0))
  assert.equal(assigned.ambiguous, false)
  const report = reconcileIdentities(
    [{ identity: assigned.identity, accountRef: 'acct-a', projectId: null, funding: 'included', nominalUnits: BigInt(10) }],
    [{ identity: assigned.identity, accountRef: 'acct-a', projectId: 'itrader', funding: 'included', nominalUnits: BigInt(10) }],
  )
  assert.equal(report.matched, 0)
  assert.equal(report.conflicting, 1)
  assert.equal(report.forcedProject, null)
})

test('a fourth account stays outside iTrader and overlapping status counts are not added', () => {
  const coverage = explainAccountCoverage([
    { accountRef: 'shared', side: 'accounts', nominalUnits: BigInt(5), projectId: 'itrader' },
    { accountRef: 'shared', side: 'itrader', nominalUnits: BigInt(5), projectId: 'itrader' },
    { accountRef: 'fourth', side: 'accounts', nominalUnits: BigInt(9), projectId: null },
  ])
  assert.equal(coverage.sharedAccounts, 1)
  assert.equal(coverage.accountsOnly[0].accountRef, 'fourth')
  assert.equal(coverage.accountsOnly[0].projects[0], 'unassigned')
  const overlap = explainStatusOverlap([
    { unassigned: true, held: true, fxMissing: false },
    { unassigned: false, held: true, fxMissing: false },
    { unassigned: false, held: false, fxMissing: true },
  ])
  assert.equal(overlap.unassignedAndHeld, 1)
  assert.equal(overlap.heldAndFx, 0)
  assert.equal(overlap.union, 3)
  assert.equal(overlap.addedHeadline, 4)
  assert.notEqual(overlap.addedHeadline, overlap.union)
  assert.match(overlap.note, /Do not add/)
})
