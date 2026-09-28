import test from 'node:test'
import assert from 'node:assert/strict'
import { cursorCsvHeaders, parseCursorCsv } from './csv-evidence'

const row = ['2026-09-09T19:04:10.845Z','','','On-Demand','cursor-grok-4.6-xhigh-fast','No','0','672','385216','134','386022','0.39']
const quote = (values: string[]) => values.map(value => `"${value.replace(/"/g, '""')}"`).join(',')
const parse = (rows = [row], extra = {}) => parseCursorCsv({ accountEmail: 'mattduff36@gmail.com', filename: 'usage.csv', csv: cursorCsvHeaders.join(',') + '\r\n' + rows.map(quote).join('\r\n'), ...extra })

test('CSV keeps rounded money as display evidence and never produces financial values', () => {
  const result = parse()
  assert.equal(result.rows[0].evidence.displayCost, '0.39')
  assert.equal(result.rows[0].cacheReadTokens, BigInt(385216))
  assert.equal('providerUnits' in result.rows[0], false)
  assert.equal('nominalUnits' in result.rows[0], false)
  assert.equal('accountRef' in result.rows[0], false)
  assert.equal('linkedEventId' in result.rows[0], false)
})

test('fingerprints survive renamed reordered exports; exact repeats deduplicate without merging different token counts', () => {
  const other = [...row]; other[7] = '673'
  const a = parse([row, other, row])
  const b = parse([other, row], { filename: 'renamed.csv' })
  assert.equal(a.received, 3)
  assert.equal(a.rows.length, 2)
  assert.deepEqual(a.rows.map(r => r.fingerprint).sort(), b.rows.map(r => r.fingerprint).sort())
  assert.notEqual(a.sourceSha256, b.sourceSha256)
})

test('parser handles quoted commas and quotes, preserves included strings', () => {
  const quoted = [...row]; quoted[4] = 'model, "variant"'; quoted[11] = 'Included'
  const result = parse([quoted])
  assert.equal(result.rows[0].model, 'model, "variant"')
  assert.equal(result.rows[0].evidence.displayCost, 'Included')
})

test('missing token counts remain unknown rather than zero', () => {
  const free = [...row]; for (let i = 6; i <= 10; i++) free[i] = ''; free[11] = 'Free'
  const result = parse([free]).rows[0]
  assert.equal(result.totalTokens, null)
  assert.equal(result.inputTokens, null)
  assert.equal(result.evidence.displayCost, 'Free')
})

test('unexpected account, arbitrary identity, headers, malformed quoting and unsafe tokens fail closed', () => {
  assert.throws(() => parse([row], { accountEmail: 'someone@example.com' }))
  assert.throws(() => parse([row], { accountRef: 'invented' }))
  assert.throws(() => parse([row], { csv: 'Date,Cost\n2026-09-01,2' }))
  assert.throws(() => parse([row], { csv: cursorCsvHeaders.join(',') + '\n"unterminated' }))
  for (const bad of ['-1', '1.5', '9007199254740992']) {
    const changed = [...row]; changed[7] = bad
    assert.throws(() => parse([changed]))
  }
  const changed = [...row]; changed[0] = '2026-02-30T19:04:10.845Z'
  assert.throws(() => parse([changed]))
})

test('same CSV is scoped to explicitly selected account and cannot self-identify an account', () => {
  const gmail = parse()
  const hotmail = parse([row], { accountEmail: 'mattduff36@hotmail.com' })
  assert.equal(gmail.rows[0].fingerprint, hotmail.rows[0].fingerprint)
  assert.notEqual(gmail.accountEmail, hotmail.accountEmail)
})
