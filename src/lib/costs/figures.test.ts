import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isConfirmedProviderCash, outstandingLabel, summariseProjects, type UsageGroup } from './figures'

const group = (patch: Partial<UsageGroup>): UsageGroup => ({
  slug: 'itrader', name: 'iTrader', provider: 'cursor', funding: 'included', currency: 'USD', quality: 'complete', assigned: true,
  rows: 1, nominalUnits: BigInt(10_000_000), providerUnits: BigInt(0), missingNominal: 0, ...patch,
})

test('assigned usage excludes unassigned rows and free-credit cash', () => {
  const projects = summariseProjects([
    group({}),
    group({ slug: 'unassigned', name: 'Unassigned', assigned: false, nominalUnits: BigInt(40_000_000) }),
    group({ funding: 'unknown', nominalUnits: BigInt(2_000_000), providerUnits: BigInt(5_000_000) }),
    group({ provider: 'vercel', funding: 'infrastructure', nominalUnits: BigInt(3_000_000), providerUnits: BigInt(3_000_000) }),
  ], [], [])
  const itrader = projects.find(project => project.slug === 'itrader')
  const unassigned = projects.find(project => project.slug === 'unassigned')
  assert.equal(itrader?.usage[0].units, BigInt(12_000_000))
  assert.equal(itrader?.confirmedProvider[0].units, BigInt(3_000_000))
  assert.equal(itrader?.freeCredit[0].units, BigInt(5_000_000))
  assert.equal(itrader?.provisionalCharge[0].units, BigInt(8_000_000))
  assert.equal(unassigned?.usage[0].units, BigInt(40_000_000))
  assert.equal(unassigned?.provisionalCharge.length, 0)
  assert.equal(unassigned?.heldRows, 1)
  assert.equal(isConfirmedProviderCash('cursor', 'unknown'), false)
})

test('missing approval is not a zero outstanding balance', () => {
  const [project] = summariseProjects([group({})], [], [])
  assert.equal(project.outstandingPence, null)
  assert.equal(outstandingLabel(null), 'Not established')
  const approved = summariseProjects([group({})], [{ slug: 'itrader', approvedPence: 1234 }], [])[0]
  assert.equal(approved.outstandingPence, 1234)
  assert.equal(outstandingLabel(1234), '£12.34')
})

test('allocated expenses stay off the unassigned figure', () => {
  const projects = summariseProjects([
    group({}),
    group({ slug: 'unassigned', name: 'Unassigned', assigned: false }),
  ], [], [{ slug: 'itrader', pence: 500 }, { slug: 'unassigned', pence: 900 }])
  assert.equal(projects.find(project => project.slug === 'itrader')?.allocatedExpensePence, 500)
  assert.equal(projects.find(project => project.slug === 'unassigned')?.allocatedExpensePence, 0)
})
