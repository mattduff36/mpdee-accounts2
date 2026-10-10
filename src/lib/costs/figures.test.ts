import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decimalUnits } from './money'
import { countsAsUnassignedProviderCash } from './charge-eligibility'
import { DEFAULT_CALCULATION_RATES } from './calculation-settings'
import { currentApprovedTotals, groupSourceUsage, isConfirmedProviderCash, nativeText, outstandingLabel, sourceEligibilityFor, summariseProjects, totalsByCurrency, type UsageGroup } from './figures'

const group = (patch: Partial<UsageGroup>): UsageGroup => ({
  slug: 'itrader', name: 'iTrader', provider: 'cursor', funding: 'included', currency: 'USD', quality: 'complete', assigned: true,
  model: 'claude-4.6-sonnet', sourceKey: 'usage:0', coveredByProviderInvoice: false, rows: 1, nominalUnits: BigInt(10_000_000), providerUnits: BigInt(0), ...patch,
})

test('assigned usage excludes unassigned rows and keeps unknown funding out of free credit', () => {
  const projects = summariseProjects([
    group({}),
    group({ slug: 'unassigned', name: 'Unassigned', assigned: false, nominalUnits: BigInt(40_000_000) }),
    group({ funding: 'unknown', nominalUnits: BigInt(2_000_000), providerUnits: BigInt(5_000_000) }),
    group({ funding: 'free-credit', nominalUnits: BigInt(0), providerUnits: BigInt(7_000_000) }),
    group({ provider: 'vercel', funding: 'infrastructure', model: null, nominalUnits: BigInt(3_000_000), providerUnits: BigInt(3_000_000) }),
  ], [], [])
  const itrader = projects.find(project => project.slug === 'itrader')
  const unassigned = projects.find(project => project.slug === 'unassigned')
  assert.equal(itrader?.usage[0].units, BigInt(12_000_000))
  assert.equal(itrader?.confirmedProvider[0].units, BigInt(3_000_000))
  assert.equal(itrader?.freeCredit[0].units, BigInt(7_000_000))
  assert.equal(itrader?.freeCredit[0].units === BigInt(5_000_000), false)
  assert.equal(itrader?.provisionalCharge[0].units, BigInt(8_000_000))
  assert.equal(itrader?.heldRows, 1)
  assert.equal(unassigned?.usage[0].units, BigInt(40_000_000))
  assert.equal(unassigned?.provisionalCharge.length, 0)
  assert.equal(unassigned?.heldRows, 1)
  assert.equal(isConfirmedProviderCash('cursor', 'unknown'), false)
  assert.equal(isConfirmedProviderCash('cursor', 'free-credit'), false)
  assert.equal(isConfirmedProviderCash('cursor', 'on-demand'), true)
})

test('missing approval is not a zero outstanding balance', () => {
  const [project] = summariseProjects([group({})], [], [])
  assert.equal(project.outstandingPence, null)
  assert.equal(outstandingLabel(null), 'Not established')
  const approved = summariseProjects([group({})], [{ slug: 'itrader', approvedPence: 1234 }], [])[0]
  assert.equal(approved.outstandingPence, 1234)
  assert.equal(outstandingLabel(1234), '£12.34')
})

test('an approved replacement is not added to the snapshot it replaces', () => {
  const totals = currentApprovedTotals([
    { id: 'old', projectId: 'p', replacesSnapshotId: null, clientChargePence: 100 },
    { id: 'new', projectId: 'p', replacesSnapshotId: 'old', clientChargePence: 40 },
    { id: 'kept', projectId: 'p', replacesSnapshotId: null, clientChargePence: 15 },
    { id: 'blank', projectId: 'q', replacesSnapshotId: null, clientChargePence: null },
  ])
  assert.deepEqual(totals, [{ projectId: 'p', approvedPence: 55 }])
  const [project] = summariseProjects([group({})], [], [])
  assert.equal(project.outstandingPence, null)
})

test('allocated expenses stay off the unassigned figure', () => {
  const projects = summariseProjects([
    group({}),
    group({ slug: 'unassigned', name: 'Unassigned', assigned: false }),
  ], [], [{ slug: 'itrader', pence: 500 }, { slug: 'unassigned', pence: 900 }])
  assert.equal(projects.find(project => project.slug === 'itrader')?.allocatedExpensePence, 500)
  assert.equal(projects.find(project => project.slug === 'unassigned')?.allocatedExpensePence, 0)
})

test('mixed models are priced per project, with Grok included at zero and Composer on-demand at cash', () => {
  const projects = summariseProjects([
    group({ rows: 2, nominalUnits: BigInt(10_000_000) }),
    group({ model: 'grok-4', rows: 2, nominalUnits: BigInt(10_000_000), providerUnits: BigInt(0) }),
    group({ slug: 'other', name: 'Other', model: 'composer-2', funding: 'on-demand', rows: 3, nominalUnits: BigInt(10_000_000), providerUnits: BigInt(4_000_000) }),
    group({ slug: 'other', name: 'Other', model: 'default', nominalUnits: BigInt(8_000_000) }),
    group({ slug: 'other', name: 'Other', model: null, funding: 'on-demand', nominalUnits: BigInt(9_000_000), providerUnits: BigInt(1_000_000) }),
  ], [], [])
  const itrader = projects.find(project => project.slug === 'itrader')
  const other = projects.find(project => project.slug === 'other')
  assert.equal(itrader?.provisionalCharge[0].units, BigInt(10_000_000))
  assert.equal(itrader?.usage[0].units, BigInt(40_000_000))
  assert.equal(other?.provisionalCharge[0].units, BigInt(13_000_000))
  assert.equal(other?.heldRows, 1)
  assert.equal(other?.confirmedProvider[0].units, BigInt(13_000_000))
})

test('ambiguous models, incomplete quality, unassigned rows and missing amounts are not charged', () => {
  const [project] = summariseProjects([
    group({ model: 'AUTO' }),
    group({ model: 'unspecified', nominalUnits: BigInt(4_000_000) }),
    group({ quality: 'partial', nominalUnits: BigInt(6_000_000) }),
    group({ assigned: false, nominalUnits: BigInt(8_000_000) }),
    group({ nominalUnits: null, providerUnits: null, rows: 4 }),
    group({ model: 'claude-4.6-sonnet', funding: 'on-demand', nominalUnits: BigInt(3_000_000), providerUnits: null, rows: 2 }),
  ], [], [])
  assert.equal(project.provisionalCharge.length, 0)
  assert.equal(project.heldRows, 10)
  assert.equal(project.usage[0].missing, 4)
  assert.equal(project.usage[0].units, BigInt(10_000_000 + 4_000_000 + 6_000_000 + 8_000_000 + 3_000_000 * 2))
  assert.equal(project.confirmedProvider[0].missing, 2)
  assert.equal(project.confirmedProvider[0].units, BigInt(0))
  assert.equal(nativeText(project.confirmedProvider[0]), 'USD unavailable')
  assert.equal(nativeText({ currency: 'USD', units: BigInt(0), rows: 1, missing: 0 }), 'USD 0.0000000')
})

test('source currencies stay separate on a project charge', () => {
  const [project] = summariseProjects([
    group({ nominalUnits: BigInt(10_000_000) }),
    group({ provider: 'vercel', funding: 'infrastructure', model: null, currency: 'GBP', nominalUnits: null, providerUnits: BigInt(2_000_000) }),
  ], [], [])
  assert.deepEqual(project.provisionalCharge.map(total => total.currency).sort(), ['GBP', 'USD'])
  assert.equal(project.provisionalCharge.find(total => total.currency === 'USD')?.units, BigInt(5_000_000))
  assert.equal(project.provisionalCharge.find(total => total.currency === 'GBP')?.units, BigInt(2_000_000))
})

test('mixed source currencies and missing infrastructure cash stay unmerged', () => {
  const totals = totalsByCurrency([
    { currency: 'GBP', rows: 2, units: BigInt(100) },
    { currency: 'USD', rows: 1, units: BigInt(50) },
    { currency: 'USD', rows: 4, units: null },
    { currency: 'GBP', rows: 1, units: null },
  ])
  assert.deepEqual(totals.map(item => item.currency), ['GBP', 'USD'])
  assert.equal(totals[0].units, BigInt(200))
  assert.equal(totals[0].rows, 2)
  assert.equal(totals[0].missing, 1)
  assert.equal(totals[1].units, BigInt(50))
  assert.equal(totals[1].rows, 1)
  assert.equal(totals[1].missing, 4)
})

test('partial or review cash, membership and invoice-covered evidence are not confirmed cash or client charges', () => {
  const credit = decimalUnits('-1.25')
  const projects = summariseProjects([
    group({ provider: 'vercel', funding: 'infrastructure', model: null, currency: 'GBP', nominalUnits: null, providerUnits: credit, sourceKey: 'invoice-line-1:0' }),
    group({ provider: 'vercel', funding: 'infrastructure', model: null, currency: 'GBP', nominalUnits: null, providerUnits: decimalUnits('0.38'), sourceKey: 'vercel:membership:2026-09-01:0' }),
    group({ funding: 'on-demand', quality: 'partial', nominalUnits: BigInt(4_000_000), providerUnits: BigInt(4_000_000), sourceKey: 'partial:0' }),
    group({ funding: 'on-demand', quality: 'review', nominalUnits: BigInt(6_000_000), providerUnits: BigInt(6_000_000), sourceKey: 'review:0' }),
    group({ funding: 'on-demand', coveredByProviderInvoice: true, nominalUnits: BigInt(8_000_000), providerUnits: BigInt(8_000_000), sourceKey: 'covered:0' }),
    group({ slug: 'unassigned', name: 'Unassigned', assigned: false, provider: 'vercel', funding: 'infrastructure', model: null, nominalUnits: null, providerUnits: BigInt(3_000_000), sourceKey: 'focus-real:0' }),
  ], [], [])
  const itrader = projects.find(project => project.slug === 'itrader')
  const unassigned = projects.find(project => project.slug === 'unassigned')
  assert.equal(itrader?.confirmedProvider.find(total => total.currency === 'GBP')?.units, credit)
  assert.equal(itrader?.provisionalCharge.find(total => total.currency === 'GBP')?.units, credit)
  assert.equal(itrader?.confirmedProvider.some(total => total.currency === 'USD'), false)
  assert.equal(itrader?.provisionalCharge.some(total => total.currency === 'USD'), false)
  assert.equal(itrader?.heldRows, 2)
  assert.equal(unassigned?.confirmedProvider[0].units, BigInt(3_000_000))
  assert.equal(unassigned?.provisionalCharge.length, 0)
  assert.equal(countsAsUnassignedProviderCash(group({ slug: 'unassigned', name: 'Unassigned', assigned: false, provider: 'vercel', funding: 'infrastructure', model: null, nominalUnits: null, providerUnits: BigInt(3_000_000), sourceKey: 'focus-real:0' })), true)
  assert.equal(countsAsUnassignedProviderCash(group({ assigned: false, provider: 'vercel', funding: 'infrastructure', model: null, sourceKey: 'vercel:membership:2026-09-01:0' })), false)
  assert.equal(countsAsUnassignedProviderCash(group({ assigned: false, provider: 'vercel', funding: 'infrastructure', model: null, coveredByProviderInvoice: true, sourceKey: 'focus-covered:0' })), false)
  assert.equal(isConfirmedProviderCash('cursor', 'on-demand'), true)
  assert.equal(isConfirmedProviderCash('vercel', 'infrastructure'), true)
})

test('fractional included units are rounded per row before multiplying by count', () => {
  const [project] = summariseProjects([
    group({ rows: 101, nominalUnits: BigInt(15), providerUnits: BigInt(0) }),
  ], [], [])
  assert.equal(project.provisionalCharge[0].units, BigInt(808))
  assert.equal(project.provisionalCharge[0].rows, 101)
  assert.notEqual(project.provisionalCharge[0].units, BigInt(758))
  assert.notEqual(project.provisionalCharge[0].units, BigInt(15 * 101))
})

test('a nonbillable policy is a known zero and a missing policy is held, while source amounts stay', () => {
  const quiet = summariseProjects([
    group({ sourceEligibility: 'nonbillable', funding: 'on-demand', nominalUnits: BigInt(10_000_000), providerUnits: BigInt(4_000_000) }),
  ], [], [])[0]
  assert.equal(quiet.usage[0].units, BigInt(10_000_000))
  assert.equal(quiet.confirmedProvider[0].units, BigInt(4_000_000))
  assert.equal(quiet.provisionalCharge[0].units, BigInt(0))
  assert.equal(quiet.provisionalCharge[0].rows, 1)
  assert.equal(quiet.heldRows, 0)
  const open = summariseProjects([
    group({ sourceEligibility: 'uncovered', funding: 'on-demand', nominalUnits: BigInt(10_000_000), providerUnits: BigInt(4_000_000) }),
  ], [], [])[0]
  assert.equal(open.usage[0].units, BigInt(10_000_000))
  assert.equal(open.confirmedProvider[0].units, BigInt(4_000_000))
  assert.equal(open.provisionalCharge.length, 0)
  assert.equal(open.heldRows, 1)
})

test('project coverage ends on its last day and the client policy covers the following gap', () => {
  const rates = { billable: false, includedBaseBps: 6000, markupBps: 1000, infrastructureMarkupBps: 2500 }
  const policies = [
    { ...rates, id: 'project', projectId: 'p', clientId: null, effectiveAt: new Date('2026-09-01T00:00:00.000Z'), effectiveUntil: new Date('2026-09-10T00:00:00.000Z') },
    { ...rates, billable: true, id: 'client', projectId: null, clientId: 'c', effectiveAt: new Date('2026-01-01T00:00:00.000Z'), effectiveUntil: null },
  ]
  assert.equal(sourceEligibilityFor(policies, 'p', 'c', new Date('2026-09-10T18:00:00.000Z')), 'nonbillable')
  assert.equal(sourceEligibilityFor(policies, 'p', 'c', new Date('2026-09-11T00:00:00.000Z')), 'billable')
  assert.equal(sourceEligibilityFor(policies, 'p', 'c', new Date('2026-08-15T00:00:00.000Z')), 'billable')
  assert.equal(sourceEligibilityFor([], 'p', 'c', new Date('2026-09-05T00:00:00.000Z')), 'uncovered')
  assert.equal(sourceEligibilityFor(policies, null, 'c', new Date('2026-09-11T00:00:00.000Z')), undefined)
})

test('configured rates change the billable charge and a daily fee remains when every source row is held', () => {
  const rates = new Map([['itrader', { ...DEFAULT_CALCULATION_RATES, includedPremiumBps: 2500 }]])
  const priced = summariseProjects([
    group({ sourceEligibility: 'billable', rows: 2, nominalUnits: BigInt(10_000_000) }),
  ], [], [], { ratesBySlug: rates })[0]
  assert.equal(priced.provisionalCharge[0].units, BigInt(5_000_000))
  assert.equal(priced.usage[0].units, BigInt(20_000_000))
  const held = summariseProjects([
    group({ sourceEligibility: 'uncovered', funding: 'on-demand', nominalUnits: BigInt(8_000_000), providerUnits: BigInt(8_000_000) }),
  ], [], [], { hostingFees: [{ slug: 'itrader', name: 'iTrader', amountPence: 38, days: 1 }] })[0]
  assert.equal(held.heldRows, 1)
  assert.equal(held.confirmedProvider[0].units, BigInt(8_000_000))
  assert.equal(held.provisionalCharge[0].currency, 'GBP')
  assert.equal(held.provisionalCharge[0].units, BigInt(3_800_000))
  assert.equal(held.provisionalCharge[0].rows, 1)
})

test('identical source amounts stay per event when eligibility differs', () => {
  const { rows: _rows, ...base } = group({})
  const grouped = groupSourceUsage([
    base,
    { ...base, sourceEligibility: 'billable' },
    { ...base, sourceEligibility: 'billable' },
    { ...base, sourceEligibility: 'nonbillable' },
  ])
  assert.equal(grouped.length, 3)
  assert.equal(grouped.find(item => item.sourceEligibility === 'billable')?.rows, 2)
  assert.equal(grouped.find(item => item.sourceEligibility === 'billable')?.nominalUnits, BigInt(10_000_000))
  assert.equal(grouped.find(item => item.sourceEligibility === undefined)?.rows, 1)
})
