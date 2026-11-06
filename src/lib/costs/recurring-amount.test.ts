import test from 'node:test'
import assert from 'node:assert/strict'
import { recurringAmountMinor } from './recurring-amount'
test('currency input preserves cents and rejects hidden rounding or overflow', () => {
  assert.equal(recurringAmountMinor('9.00'), 900)
  assert.equal(recurringAmountMinor('0.29'), 29)
  assert.equal(recurringAmountMinor('9.5'), 950)
  assert.equal(recurringAmountMinor('20000000'), 2_000_000_000)
  for (const value of ['9.999', '-1', '1e2', '20000000.01', '']) assert.equal(recurringAmountMinor(value), null)
})
