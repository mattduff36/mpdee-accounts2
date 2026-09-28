import test from 'node:test'
import assert from 'node:assert/strict'
import { legacyBaseline, type LegacyChargeRow } from './legacy-baseline'
const row = (id = 'one', amount = 38): LegacyChargeRow => ({ id, projectId: 'project', sourceRevision: 1, sourceChecksum: 'checksum', category: 'VERCEL_HOSTING', periodStart: new Date('2026-08-13T23:00:00.000Z'), periodEnd: new Date('2026-08-14T23:00:00.000Z'), label: 'Membership', frozenGbpPence: amount, invoiceability: 'INVOICEABLE' })
test('preserves exact signed pence, zeros, category and original exclusive timestamps', () => {
  const result = legacyBaseline('itrader', 'project', [row('credit', -5000), row('zero', 0), row('member')])
  assert.deepEqual(result.lines.map(line => line.amountMinor), [-5000, 38, 0])
  assert.equal(result.lines[1].periodStart, '2026-08-13T23:00:00.000Z')
  assert.equal(result.lines[1].periodEnd, '2026-08-14T23:00:00.000Z')
  assert.equal(result.periodEndExclusive, true)
  assert.equal(result.lines[1].category, 'VERCEL_HOSTING')
})
test('stable replay and ordering; revision detects changed source or amount', () => {
  const a = legacyBaseline('itrader', 'project', [row('b'), row('a')])
  assert.deepEqual(a, legacyBaseline('itrader', 'project', [row('a'), row('b')]))
  for (const changed of [{ ...row('a'), sourceRevision: 2 }, { ...row('a'), frozenGbpPence: 39 }, { ...row('a'), sourceChecksum: 'new' }]) {
    const b = legacyBaseline('itrader', 'project', [changed, row('b')])
    assert.equal(a.lines[0].id, b.lines[0].id)
    assert.notEqual(a.revision, b.revision)
  }
})
test('rejects cross-project and duplicate identities, invalid money, periods and truncation', () => {
  assert.throws(() => legacyBaseline('itrader', 'project', [{ ...row(), projectId: 'other' }]))
  assert.throws(() => legacyBaseline('itrader', 'project', [row(), row()]))
  for (const amount of [0.5, NaN, 2147483648]) assert.throws(() => legacyBaseline('itrader', 'project', [row('one', amount)]))
  assert.throws(() => legacyBaseline('itrader', 'project', [{ ...row(), periodEnd: row().periodStart }]))
  assert.throws(() => legacyBaseline('itrader', 'project', Array(50001).fill(row())))
})
test('projection excludes private identities and evidence, including unrecognized input fields', () => {
  const input = { ...row(), sourceDatabaseFingerprint: 'private-db', sourceBucket: 'private-account', sourceEvidence: { credential: 'must-not-appear' } }
  const text = JSON.stringify(legacyBaseline('itrader', 'project', [input]))
  for (const privateText of ['private-db', 'private-account', 'must-not-appear', 'checksum', 'sourceRevision', 'projectId']) assert.equal(text.includes(privateText), false)
  assert.deepEqual(legacyBaseline('itrader', 'project', []).lines, [])
})
