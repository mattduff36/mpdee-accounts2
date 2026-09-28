import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectLedgerResponse } from './project-ledger-response'

test('project response minimizes data and totals native currency without approved snapshot claims', () => {
  const result = projectLedgerResponse('2026-09', 'alpha', [{
    event: { id: 'secret-event-id', accountRef: 'secret-account', conversationId: 'secret-conversation', occurredAt: new Date('2026-09-10T12:00:00Z'), provider: 'cursor', model: 'example-model', project: { slug: 'other-project', clientId: 'secret-client' } } as never,
    revision: { funding: 'included', nominalUnits: BigInt(10_000_000), providerUnits: BigInt(0), currency: 'USD', quality: 'complete', evidence: { secret: 'raw source' } } as never,
    hold: null,
    charge: BigInt(5_000_000),
  }])
  const serialized = JSON.stringify(result)
  assert.equal(result.status, 'provisional-estimates')
  assert.equal(result.approvedSnapshot, false)
  assert.equal(result.rows[0].nominal, '1.0000000')
  assert.equal(result.rows[0].estimatedCharge, '0.5000000')
  assert.deepEqual(result.totals, [{ currency: 'USD', events: 1, nominal: '1.0000000', providerCost: '0.0000000', estimatedCharge: '0.5000000' }])
  for (const secret of ['secret-event-id', 'secret-account', 'secret-conversation', 'secret-client', 'raw source', 'other-project']) assert.equal(serialized.includes(secret), false)
})
