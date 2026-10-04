import assert from 'node:assert/strict'
import { test } from 'node:test'
import { billCoverage, sourceDateFromNotes, unresolvedCoverageText } from './bill-coverage'
import { bookTimeInLedger } from './ledger-window'

const cursorBill = {
  reference: 'provider-bill',
  booked: '2026-08-13 00:00:00',
  grossPence: 100,
  sourceDate: '2026-08-12',
  periodStart: null,
  periodEnd: null,
}

test('a booking time before the ledger instant stays unresolved without a service period', () => {
  assert.equal(bookTimeInLedger(cursorBill.booked), false)
  const coverage = billCoverage(cursorBill)
  assert.equal(coverage.treatment, 'unresolved')
  assert.equal(coverage.countsInLedger, false)
  const text = unresolvedCoverageText(cursorBill)
  assert.match(text, /source date of 2026-08-12/)
  assert.match(text, /service period is still required/)
  assert.equal(text.includes('financially verified'), false)
})

test('a recorded service period can overlap the ledger or end before it', () => {
  assert.equal(billCoverage({ ...cursorBill, periodStart: '2026-08-01', periodEnd: '2026-08-31' }).treatment, 'overlap')
  assert.equal(billCoverage({ ...cursorBill, periodStart: '2026-08-01', periodEnd: '2026-08-12' }).countsInLedger, false)
  assert.equal(billCoverage({ ...cursorBill, periodStart: '2026-08-01', periodEnd: '2026-08-12' }).treatment, 'outside-period')
})

test('source date is read from the accounts-book note', () => {
  assert.equal(sourceDateFromNotes('GBP basis: actual_payment; source date 2026-08-12.'), '2026-08-12')
  assert.equal(sourceDateFromNotes(unresolvedCoverageText(cursorBill)), '2026-08-12')
  assert.equal(sourceDateFromNotes('Invoice only'), null)
})
