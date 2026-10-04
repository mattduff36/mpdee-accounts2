import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bookTimeInLedger } from './ledger-window'

test('a book time of 2026-08-13 00:00:00 is before the ledger instant', () => {
  assert.equal(bookTimeInLedger('2026-08-13 00:00:00'), false)
})

test('a book time on 14 August stays inside the ledger', () => {
  assert.equal(bookTimeInLedger('2026-08-14 00:00:00'), true)
  assert.equal(bookTimeInLedger('2026-08-13 23:00:00'), true)
})
