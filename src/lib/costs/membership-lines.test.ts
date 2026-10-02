import test from 'node:test'
import assert from 'node:assert/strict'
import { londonDayPeriod, membershipDates, planMembershipRewrite } from './membership-lines'
import { parseUtcDate } from './project-matrix'

test('London membership days use the exclusive midnight already stored for August', () => {
  const period = londonDayPeriod('2026-08-14')
  assert.equal(period.periodStart.toISOString(), '2026-08-13T23:00:00.000Z')
  assert.equal(period.periodEnd.toISOString(), '2026-08-14T23:00:00.000Z')
  assert.equal(londonDayPeriod('2026-12-01').periodStart.toISOString(), '2026-12-01T00:00:00.000Z')
})
test('membership dates stop at the next rate and do not run past today', () => {
  const first = { effectiveAt: parseUtcDate('2026-08-01'), effectiveUntil: null }
  const next = { effectiveAt: parseUtcDate('2026-09-28'), effectiveUntil: null }
  assert.deepEqual(membershipDates(first, [first, next], '2026-10-02').at(-1), '2026-09-27')
  assert.equal(membershipDates(next, [first, next], '2026-10-02')[0], '2026-09-28')
  assert.equal(membershipDates(next, [first, next], '2026-10-02').at(-1), '2026-10-02')
  assert.deepEqual(membershipDates({ effectiveAt: parseUtcDate('2026-10-03'), effectiveUntil: null }, [], '2026-10-02'), [])
})
test('rewrites membership amounts and adds missing days without touching other rows', () => {
  const existing = [{ id: 'boundary', sourceBucket: 'vercel:membership:2026-08-13', periodStart: new Date('2026-08-13T22:00:00.000Z'), periodEnd: new Date('2026-08-13T23:00:00.000Z'), frozenGbpPence: 0, sourceRevision: 2 }, { id: 'day', sourceBucket: 'vercel:membership:2026-08-14', periodStart: new Date('2026-08-13T23:00:00.000Z'), periodEnd: new Date('2026-08-14T23:00:00.000Z'), frozenGbpPence: 38, sourceRevision: 1 }, { id: 'cpu', sourceBucket: 'vercel:build-cpu:2026-08-14', periodStart: new Date('2026-08-13T23:00:00.000Z'), periodEnd: new Date('2026-08-14T23:00:00.000Z'), frozenGbpPence: 12, sourceRevision: 1 }]
  const same = planMembershipRewrite(existing, ['2026-08-13', '2026-08-14'], 38)
  assert.deepEqual(same.inserts, [])
  assert.equal(same.updates.length, 1)
  assert.equal(same.updates[0].id, 'boundary')
  assert.equal(same.updates[0].frozenGbpPence, 38)
  assert.equal(same.updates[0].sourceRevision, 3)
  const added = planMembershipRewrite(existing, ['2026-08-15'], 50)
  assert.equal(added.updates.length, 0)
  assert.equal(added.inserts[0].sourceBucket, 'vercel:membership:2026-08-15')
  assert.equal(added.inserts[0].periodStart.toISOString(), '2026-08-14T23:00:00.000Z')
  assert.equal(added.inserts[0].frozenGbpPence, 50)
  assert.equal(planMembershipRewrite(existing, ['2026-08-14'], 38).updates.length, 0)
})
