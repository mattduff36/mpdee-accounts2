import assert from 'node:assert/strict'
import test from 'node:test'
import { decimalUnits, chargeUnits, gbpPence } from './money'
import { COMPARISON_POLICY, ITRADER_KNOWN_PROJECT_SEED, policyInventory, revisionOutcome } from './comparison-policy'
import { londonDayPeriod } from './membership-lines'
import { normalize, importSchema } from './normalize'

const raw = { timestamp: '2026-09-26T15:36:24.000Z', model: 'example', conversationId: 'conversation-1', isTokenBasedCall: true, kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO', chargedCents: 0, usageBasedCosts: '0.00', cursorTokenFee: 0, tokenUsage: { totalCents: '10' } }

test('comparison policy is 50 percent included, 100 percent on-demand, and face-value infrastructure', () => {
  assert.equal(COMPARISON_POLICY.vercelDailyPence, 0)
  assert.equal(unitsTextOf(chargeUnits({ provider: 'cursor', funding: 'included', nominal: decimalUnits('10'), cash: BigInt(0) }, COMPARISON_POLICY)!), '5.0000000')
  assert.equal(unitsTextOf(chargeUnits({ provider: 'cursor', funding: 'on-demand', nominal: decimalUnits('10'), cash: decimalUnits('10') }, COMPARISON_POLICY)!), '10.0000000')
  assert.equal(unitsTextOf(chargeUnits({ provider: 'vercel', funding: 'infrastructure', nominal: null, cash: decimalUnits('4') }, COMPARISON_POLICY)!), '4.0000000')
  const seeded = { ...COMPARISON_POLICY, markupBps: ITRADER_KNOWN_PROJECT_SEED.markupBps }
  assert.equal(unitsTextOf(chargeUnits({ provider: 'cursor', funding: 'included', nominal: decimalUnits('10'), cash: BigInt(0) }, seeded)!), '6.0000000')
  assert.equal(ITRADER_KNOWN_PROJECT_SEED.vercelDailyPence, 38)
})

test('policy inventory keeps unread database rows distinct from code defaults and the seed', () => {
  const unread = policyInventory(null)
  assert.equal(unread.storedPoliciesRead, false)
  assert.equal(unread.unreadReason, 'Live policy rows were not read.')
  assert.equal(unread.codeDefaults.markupBps, 0)
  const read = policyInventory([{ id: 'p', scopeKey: 'project:p', projectSlug: 'itrader', effectiveAt: '2026-08-01T00:00:00.000Z', effectiveUntil: null, billable: true, includedBaseBps: 5000, markupBps: 1000, infrastructureMarkupBps: 0, vercelDailyPence: 38 }])
  assert.equal(read.storedPoliciesRead, true)
  assert.equal(read.storedPolicies?.[0].markupBps, 1000)
  assert.equal(read.comparison.markupBps, 0)
})

test('an unchanged import adds no revision and a source correction appends one', () => {
  const input = importSchema.parse({ provider: 'cursor', accountRef: 'test-account', quality: 'complete', events: [raw] })
  const first = normalize(input)[0]
  const replay = normalize(input)[0]
  assert.deepEqual(revisionOutcome(first.checksum, replay.checksum), { added: 0, revised: 0, duplicate: 1 })
  const corrected = normalize(importSchema.parse({ provider: 'cursor', accountRef: 'test-account', quality: 'complete', events: [{ ...raw, tokenUsage: { totalCents: '11' } }] }))[0]
  assert.equal(first.sourceKey, corrected.sourceKey)
  assert.deepEqual(revisionOutcome(first.checksum, corrected.checksum), { added: 0, revised: 1, duplicate: 0 })
  assert.deepEqual(revisionOutcome(null, first.checksum), { added: 1, revised: 0, duplicate: 0 })
})

test('Europe/London membership days are 23 hours across the spring change and 25 across the autumn change', () => {
  const spring = londonDayPeriod('2026-03-29')
  const autumn = londonDayPeriod('2026-10-25')
  assert.equal(spring.periodEnd.getTime() - spring.periodStart.getTime(), 23 * 60 * 60 * 1000)
  assert.equal(autumn.periodEnd.getTime() - autumn.periodStart.getTime(), 25 * 60 * 60 * 1000)
  assert.equal(spring.periodEnd.toISOString() > spring.periodStart.toISOString(), true)
})

test('source units convert to pence once', () => {
  assert.equal(gbpPence(decimalUnits('2.3365'), '0.75'), BigInt(175))
})

function unitsTextOf(value: bigint) {
  const negative = value < BigInt(0)
  const absolute = negative ? -value : value
  return `${negative ? '-' : ''}${absolute / BigInt(10000000)}.${String(absolute % BigInt(10000000)).padStart(7, '0')}`
}
