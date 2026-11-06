import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MANUAL_ALLOCATION_VERSION, allocateMinor, allocatedSourceAmounts, allocationSharesSchema,
  manualAllocationSchema, manualAllocationQuerySchema, manualAllocationState, percentageBps,
  saveManualAllocation, ManualAllocationError, type ManualAllocationInput, type ManualAllocationStore,
} from './manual-allocation'
import { stateFromAllocation, recurringGbpEstimate } from './manual-allocation-store'
import { summarizeManualAllocations } from './manual-allocation-report'
import { saveSubscriptionRecord, type SubscriptionStore } from './subscription-record'
import { createCustomRecurring, recurringFields, type CustomRecurringIdentity, type CustomRecurringFields, type CustomRecurringStore } from './custom-recurring'

const fixture: ManualAllocationInput = {
  version: MANUAL_ALLOCATION_VERSION, sourceKind: 'subscription_invoice', sourceId: 'invoice_one',
  expectedRevision: 0, shares: [{ projectId: 'project_a', shareBps: 2500 }, { projectId: 'project_b', shareBps: 3333 }],
}
function setup() {
  let current = manualAllocationState(null)
  const history: { actorId: string; snapshot: typeof current }[] = []
  const store: ManualAllocationStore = {
    sourceExists: async (kind, id) => ['subscription_invoice', 'custom_recurring'].includes(kind) && id === fixture.sourceId,
    currentRevision: async () => current.revision,
    projectsExist: async ids => ids.every(id => ['project_a', 'project_b'].includes(id)),
    commit: async (input, actorId) => {
      if (input.expectedRevision !== current.revision) throw new ManualAllocationError(409, 'Concurrent change')
      current = manualAllocationState({ revision: current.revision + 1, shares: input.shares })
      history.push({ actorId, snapshot: structuredClone(current) })
      return current
    },
  }
  return { store, history, current: () => current }
}
test('manual allocation conserves native and GBP integer amounts including explicit remainder', () => {
  const state = manualAllocationState({ revision: 1, shares: fixture.shares })
  const buckets = allocatedSourceAmounts(101, 79, state)
  assert.equal(state.unallocatedBps, 4167)
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.amountMinor, 0), 101)
  assert.equal(buckets.reduce((sum, bucket) => sum + (bucket.gbpEstimatePence ?? 0), 0), 79)
  assert.equal(buckets.at(-1)?.projectId, null)
  assert.deepEqual(buckets.map(bucket => bucket.amountMinor), [25, 34, 42])
  assert.deepEqual(allocatedSourceAmounts(101, null, state).map(bucket => bucket.gbpEstimatePence), [null, null, null])
})
test('largest remainder is deterministic, order-independent and uses project ID before unallocated on ties', () => {
  const shares = [{ projectId: 'b', shareBps: 5000 }, { projectId: 'a', shareBps: 5000 }]
  assert.deepEqual(allocateMinor(1, shares), [
    { projectId: 'a', shareBps: 5000, amountMinor: 1 },
    { projectId: 'b', shareBps: 5000, amountMinor: 0 },
    { projectId: null, shareBps: 0, amountMinor: 0 },
  ])
  assert.deepEqual(allocateMinor(1, shares), allocateMinor(1, [...shares].reverse()))
  assert.equal(allocateMinor(1, [{ projectId: 'a', shareBps: 5000 }])[0].amountMinor, 1)
  assert.deepEqual(allocateMinor(-1, shares).map(bucket => bucket.amountMinor), [-1, 0, 0])
})
test('conservation across zero, tiny, negative and largest safe integer amounts', () => {
  for (const amount of [0, 1, 2, 3, 7, 99, 100, 101, 2_000_000_000, Number.MAX_SAFE_INTEGER, -101]) {
    for (const shareBps of [1, 33, 4999, 5000, 9999, 10000]) {
      const shares = [{ projectId: 'a', shareBps }]
      const buckets = allocateMinor(amount, shares)
      assert.equal(buckets.reduce((sum, bucket) => sum + BigInt(bucket.amountMinor), BigInt(0)), BigInt(amount))
      assert.equal(buckets.reduce((sum, bucket) => sum + bucket.shareBps, 0), 10000)
      assert.ok(buckets.every(bucket => Number.isSafeInteger(bucket.amountMinor)))
    }
  }
  assert.deepEqual(allocateMinor(19, []), [{ projectId: null, shareBps: 10000, amountMinor: 19 }])
  assert.throws(() => allocateMinor(1.2, []), /safe integer/)
  assert.throws(() => allocateMinor(Number.MAX_SAFE_INTEGER + 1, []), /safe integer/)
})
test('strict shares reject fractions, duplicate or invalid projects, overflow and unrecognized fields', () => {
  for (const shares of [
    [{ projectId: 'a', shareBps: 0 }], [{ projectId: 'a', shareBps: -1 }],
    [{ projectId: 'a', shareBps: 1.1 }], [{ projectId: 'a', shareBps: 10001 }],
    [{ projectId: '', shareBps: 1 }], [{ projectId: 'a/b', shareBps: 1 }],
    [{ projectId: 'a', shareBps: 5001 }, { projectId: 'b', shareBps: 5000 }],
    [{ projectId: 'a', shareBps: 1 }, { projectId: 'a', shareBps: 1 }],
    [{ projectId: 'a', shareBps: 1, measured: true }],
    Array.from({ length: 101 }, (_, id) => ({ projectId: `p${id}`, shareBps: 1 })),
  ]) assert.equal(allocationSharesSchema.safeParse(shares).success, false)
  for (const change of [{ sourceKind: 'usage' }, { expectedRevision: -1 }, { expectedRevision: 0.5 }, { version: 'old' }, { sourceId: '' }, { unexpected: true }]) {
    assert.equal(manualAllocationSchema.safeParse({ ...fixture, ...change }).success, false)
  }
})
test('percentage input parses basis points without floating point or silent rounding', () => {
  for (const [value, bps] of [['0', 0], ['0.01', 1], ['33.33', 3333], ['100', 10000], ['99.99', 9999]] as const) {
    assert.equal(percentageBps(value), bps)
  }
  for (const value of ['', '-1', '100.01', '1.001', '1e2', 'NaN', ' 50', 'Infinity']) assert.equal(percentageBps(value), null)
})
test('recurring legacy project stays 100% until explicit override; empty reset never restores default', () => {
  assert.deepEqual(manualAllocationState(null, 'original'), {
    revision: 0, basis: 'legacy_single_project_default', shares: [{ projectId: 'original', shareBps: 10000 }], unallocatedBps: 0,
  })
  const reset = manualAllocationState({ revision: 2, shares: [] }, 'original')
  assert.equal(reset.basis, 'user_selected')
  assert.equal(reset.unallocatedBps, 10000)
  assert.deepEqual(reset.shares, [])
  assert.equal(manualAllocationState(null).unallocatedBps, 10000)
})
test('saved allocations append audit revisions with actor, clear is audited and stale revisions conflict', async () => {
  const context = setup()
  assert.equal((await saveManualAllocation(fixture, 'owner', context.store)).revision, 1)
  const snapshot = structuredClone(context.current())
  await assert.rejects(saveManualAllocation(fixture, 'other-owner', context.store), error => error instanceof ManualAllocationError && error.status === 409)
  assert.deepEqual(context.current(), snapshot)
  const cleared = await saveManualAllocation({ ...fixture, expectedRevision: 1, shares: [] }, 'owner', context.store)
  assert.equal(cleared.revision, 2)
  assert.equal(cleared.unallocatedBps, 10000)
  assert.equal(context.history.length, 2)
  assert.equal(context.history[0].actorId, 'owner')
  assert.deepEqual(context.history[0].snapshot.shares, fixture.shares)
})
test('simultaneous first saves and later saves cannot both overwrite the same revision', async () => {
  const context = setup()
  for (const expectedRevision of [0, 1]) {
    const outcomes = await Promise.allSettled([
      saveManualAllocation({ ...fixture, expectedRevision }, 'one', context.store),
      saveManualAllocation({ ...fixture, expectedRevision }, 'two', context.store),
    ])
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
    const failure = outcomes.find(result => result.status === 'rejected')
    assert.ok(failure?.status === 'rejected' && failure.reason instanceof ManualAllocationError && failure.reason.status === 409)
  }
  assert.equal(context.history.length, 2)
})
test('missing exact source, nonexistent projects and invalid shares cannot produce audit writes', async () => {
  const context = setup()
  await assert.rejects(saveManualAllocation({ ...fixture, sourceId: 'missing' }, 'owner', context.store), error => error instanceof ManualAllocationError && error.status === 404)
  await assert.rejects(saveManualAllocation({ ...fixture, shares: [{ projectId: 'missing', shareBps: 1 }] }, 'owner', context.store), error => error instanceof ManualAllocationError && error.status === 400)
  await assert.rejects(saveManualAllocation({ ...fixture, shares: [{ projectId: 'project_a', shareBps: 10001 }] }, 'owner', context.store))
  assert.equal(context.history.length, 0)
})
test('audit state detects missing revisions and inconsistent explicit remainder', () => {
  assert.throws(() => stateFromAllocation({ revision: 1, history: [] }), /missing/)
  assert.throws(() => stateFromAllocation({ revision: 2, history: [{ revision: 1, unallocatedBps: 10000, shares: [] }] }), /missing/)
  assert.throws(() => stateFromAllocation({ revision: 1, history: [{ revision: 1, unallocatedBps: 0, shares: [] }] }), /inconsistent/)
  assert.equal(stateFromAllocation({ revision: 1, history: [{ revision: 1, unallocatedBps: 10000, shares: [] }] }, 'original').unallocatedBps, 10000)
})
test('report aggregates allocations once, keeps currencies separate and does not invent missing GBP', () => {
  const state = manualAllocationState({ revision: 1, shares: fixture.shares })
  const row = (currency: string, amount: number, gbp: number | null) => ({
    currency, amountMinor: amount, gbpEstimatePence: gbp,
    buckets: allocatedSourceAmounts(amount, gbp, state).map(bucket => ({ ...bucket, project: null })),
  })
  const totals = summarizeManualAllocations([row('USD', 101, 79), row('USD', 101, null), row('GBP', 10, 10)])
  assert.equal(totals.filter(total => total.currency === 'USD').reduce((sum, total) => sum + total.amountMinor, 0), 202)
  assert.equal(totals.filter(total => total.currency === 'GBP').reduce((sum, total) => sum + total.amountMinor, 0), 10)
  assert.ok(totals.filter(total => total.currency === 'USD').every(total => total.gbpEstimatePence === null && total.missingGbpEstimates === 1))
  assert.equal(totals.filter(total => total.currency === 'GBP').reduce((sum, total) => sum + (total.gbpEstimatePence ?? 0), 0), 10)
})
test('recurring estimates use stored nonfuture reference FX only; absent or stale rates are unknown', () => {
  const quotes = [{ currency: 'USD', date: '2026-11-01', rate: '0.75', source: 'stored reference' }]
  assert.equal(recurringGbpEstimate(101, 'USD', '2026-11-06', quotes).gbpEstimatePence, 76)
  assert.equal(recurringGbpEstimate(101, 'GBP', '2026-11-06', []).gbpEstimatePence, 101)
  assert.equal(recurringGbpEstimate(101, 'USD', '2026-10-31', quotes).gbpEstimatePence, null)
  assert.equal(recurringGbpEstimate(101, 'USD', '2026-11-09', quotes).gbpEstimatePence, null)
})
test('bounded report query validates exact source kind, IDs, real dates and incompatible pagination', () => {
  for (const change of [
    { sourceKind: 'usage' }, { sourceId: '' }, { sourceId: 'one', after: 'two' }, { limit: '101' },
    { limit: '0' }, { asOf: '2026-02-30' }, { unknown: 'field' },
  ]) assert.equal(manualAllocationQuerySchema.safeParse({ sourceKind: 'subscription_invoice', ...change }).success, false)
  assert.deepEqual(manualAllocationQuerySchema.parse({ sourceKind: 'custom_recurring', sourceId: 'exact', asOf: '2026-11-06' }), {
    sourceKind: 'custom_recurring', sourceId: 'exact', asOf: '2026-11-06', limit: 50,
  })
})
test('subscription import replay after an allocation preserves both source evidence and user split', async () => {
  const source = {
    version: 'mpdee-subscription-v1', provider: 'openai', accountRef: 'test-account', invoiceNumber: 'test-invoice',
    product: 'Test plan', currency: 'USD', netMinor: 100, taxMinor: 0, grossMinor: 100,
    invoiceDate: '2026-11-01', paymentDate: '2026-11-01', periodStart: '2026-11-01', periodEnd: '2026-12-01',
    paymentStatus: 'paid', allocationStatus: 'unallocated', gbpEstimatePence: 75,
    fxRate: '0.75', fxDate: '2026-11-01', fxSource: 'https://www.ecb.europa.eu/reference',
    evidence: { method: 'signed_in_invoice_review', reference: 'test-invoice' },
  }
  let row: { id: string; checksum: string } | null = null
  let sourceWrites = 0
  const importStore: SubscriptionStore = {
    find: async () => row,
    create: async value => { sourceWrites++; row = { id: fixture.sourceId, checksum: value.checksum }; return row },
  }
  await saveSubscriptionRecord(source, importStore)
  const sourceBefore = structuredClone(row)
  const allocation = setup()
  await saveManualAllocation(fixture, 'owner', allocation.store)
  const splitBefore = structuredClone(allocation.current())
  assert.equal((await saveSubscriptionRecord(source, importStore)).status, 'duplicate')
  assert.deepEqual(row, sourceBefore)
  assert.deepEqual(allocation.current(), splitBefore)
  assert.equal(sourceWrites, 1)
})
test('custom commitment replay after an explicit clear cannot restore the original project or replace the split', async () => {
  const source = {
    version: 'mpdee-custom-recurring-v1', sourceKey: 'test:commitment', projectId: 'project_a',
    provider: 'Test provider', name: 'Test commitment', currency: 'GBP', amountMinor: 101,
    recurrence: 'monthly', effectiveStart: '2026-11-01', effectiveEnd: null, active: true, notes: null,
  }
  let row: (CustomRecurringIdentity & CustomRecurringFields) | null = null
  let sourceWrites = 0
  const importStore: CustomRecurringStore = {
    findSource: async () => row, findId: async () => row,
    create: async (record, importChecksum) => {
      sourceWrites++
      return row = { ...recurringFields(record), id: fixture.sourceId, revision: 1, importChecksum }
    },
    update: async () => { throw new Error('No source update is permitted in this test') },
  }
  await createCustomRecurring(source, importStore)
  const sourceBefore = structuredClone(row)
  const allocation = setup()
  await saveManualAllocation({ ...fixture, sourceKind: 'custom_recurring', shares: [] }, 'owner', allocation.store)
  assert.equal((await createCustomRecurring(source, importStore)).status, 'duplicate')
  assert.deepEqual(row, sourceBefore)
  assert.deepEqual(allocation.current().shares, [])
  assert.equal(allocation.current().unallocatedBps, 10000)
  assert.equal(allocation.current().revision, 1)
  assert.equal(sourceWrites, 1)
})
