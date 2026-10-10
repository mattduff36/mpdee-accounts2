import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countsAsUnassignedProviderCash, excludedFromClientAndConfirmedCash, isConfirmedProviderCash, showsConfirmedProviderCash } from './charge-eligibility'

const row = (patch: Partial<{ provider: string; funding: string; quality: string; sourceKey: string; coveredByProviderInvoice: boolean; assigned: boolean }>) => ({
  provider: 'vercel', funding: 'infrastructure', quality: 'complete', sourceKey: 'focus-1:0', coveredByProviderInvoice: false, assigned: true, ...patch,
})

test('only complete real provider cash is confirmed, and membership or invoice coverage is excluded', () => {
  assert.equal(showsConfirmedProviderCash(row({})), true)
  assert.equal(showsConfirmedProviderCash(row({ provider: 'cursor', funding: 'on-demand' })), true)
  assert.equal(showsConfirmedProviderCash(row({ quality: 'partial' })), false)
  assert.equal(showsConfirmedProviderCash(row({ quality: 'review' })), false)
  assert.equal(showsConfirmedProviderCash(row({ quality: 'unknown' })), false)
  assert.equal(showsConfirmedProviderCash(row({ sourceKey: 'vercel:membership:2026-09-01:0' })), false)
  assert.equal(showsConfirmedProviderCash(row({ coveredByProviderInvoice: true })), false)
  assert.equal(showsConfirmedProviderCash(row({ provider: 'cursor', funding: 'included' })), false)
  assert.equal(isConfirmedProviderCash('cursor', 'on-demand'), true)
  assert.equal(excludedFromClientAndConfirmedCash(row({ sourceKey: 'vercel:membership:2026-09-02:0' })), true)
  assert.equal(countsAsUnassignedProviderCash(row({ assigned: false })), true)
  assert.equal(countsAsUnassignedProviderCash(row({ assigned: true })), false)
  assert.equal(countsAsUnassignedProviderCash(row({ assigned: false, quality: 'partial' })), true)
  assert.equal(countsAsUnassignedProviderCash(row({ assigned: false, sourceKey: 'vercel:membership:2026-09-01:0' })), false)
  assert.equal(countsAsUnassignedProviderCash(row({ assigned: false, coveredByProviderInvoice: true })), false)
})
