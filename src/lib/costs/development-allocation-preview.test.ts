import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEVELOPMENT_ALLOCATION_PREVIEW_VERSION,
  previewDevelopmentAllocation,
  type DevelopmentAllocationEvidence,
  type DevelopmentAllocationInvoice,
} from './development-allocation-preview'

const scope: DevelopmentAllocationInvoice['scope'] = {
  provider: 'openai', accountRef: 'example-account', currency: 'USD',
  periodStart: '2026-10-28', periodEnd: '2026-11-28',
}
const invoice: DevelopmentAllocationInvoice = { scope, grossMinor: 12000 }
const measurement = (weight: string, evidenceRef: string) => ({
  scope: { ...scope }, basis: 'provider-reported-value' as const, decimalPlaces: 7, weight, evidenceRef,
})
const project = (projectId: string, weight: string) => ({
  bucket: { kind: 'project' as const, projectId }, measurement: measurement(weight, `evidence-${projectId}`),
})
function evidence(): DevelopmentAllocationEvidence {
  return {
    version: 'mpdee-development-allocation-evidence-v1',
    review: { status: 'provisional' },
    coverage: { status: 'partial' },
    accountDenominator: measurement('100', 'independent-account-total'),
    weights: [project('example-project', '25')],
  }
}
const total = (value: ReturnType<typeof previewDevelopmentAllocation>) =>
  value.projects.reduce((sum, row) => sum + row.minor, 0) + value.personalMinor + value.unassignedMinor + value.unallocatedMinor

test('no evidence keeps the full native invoice unallocated, with no input mutation or FX estimate', () => {
  const before = structuredClone(invoice)
  const result = previewDevelopmentAllocation(invoice)
  assert.equal(result.version, DEVELOPMENT_ALLOCATION_PREVIEW_VERSION)
  assert.equal(result.status, 'inactive')
  assert.equal(result.label, 'Inactive / unallocated')
  assert.equal(result.unallocatedMinor, 12000)
  assert.equal(result.currency, 'USD')
  assert.deepEqual(result.projects, [])
  assert.match(result.reason, /entire invoice remains unallocated/)
  assert.equal(total(result), 12000)
  assert.deepEqual(invoice, before)
})

test('a known subset without an independent denominator is never renormalized', () => {
  for (const coverage of ['partial', 'unknown'] as const) {
    const value = evidence()
    value.coverage = { status: coverage }
    delete value.accountDenominator
    const result = previewDevelopmentAllocation(invoice, value)
    assert.equal(result.status, 'inactive')
    assert.equal(result.unallocatedMinor, 12000)
    assert.deepEqual(result.projects, [])
    assert.match(result.reason, /cannot be renormalized/)
  }
})

test('partial account coverage allocates only its measured share and retains exact residual', () => {
  const result = previewDevelopmentAllocation(invoice, evidence())
  assert.equal(result.status, 'provisional')
  assert.equal(result.label, 'Provisional preview')
  assert.deepEqual(result.projects, [{ projectId: 'example-project', minor: 3000 }])
  assert.equal(result.unallocatedMinor, 9000)
  assert.equal(result.denominatorWeight, '100')
  assert.equal(result.unmeasuredWeight, '75')
  assert.equal(total(result), invoice.grossMinor)
})

test('personal, measured unassigned and unmeasured residual never inflate project shares', () => {
  const value = evidence()
  value.weights.push(
    { bucket: { kind: 'personal' }, measurement: measurement('20', 'personal-total') },
    { bucket: { kind: 'unassigned' }, measurement: measurement('15', 'unassigned-total') },
  )
  const result = previewDevelopmentAllocation(invoice, value)
  assert.deepEqual(result.projects, [{ projectId: 'example-project', minor: 3000 }])
  assert.equal(result.personalMinor, 2400)
  assert.equal(result.unassignedMinor, 1800)
  assert.equal(result.unallocatedMinor, 4800)
  assert.equal(result.unmeasuredWeight, '40')
  assert.equal(total(result), 12000)
})

test('verified complete coverage can establish denominator, separately from review label', () => {
  const value = evidence()
  delete value.accountDenominator
  value.coverage = { status: 'complete-verified', reference: 'full-account-review' }
  value.weights.push({ bucket: { kind: 'personal' }, measurement: measurement('75', 'personal-total') })
  assert.equal(previewDevelopmentAllocation(invoice, value).label, 'Provisional preview')
  value.review = { status: 'reviewed', reference: 'owner-review' }
  const before = structuredClone(value)
  const result = previewDevelopmentAllocation(invoice, value)
  assert.equal(result.label, 'Reviewed preview')
  assert.equal(result.status, 'reviewed')
  assert.equal(result.unallocatedMinor, 0)
  assert.equal(result.personalMinor, 9000)
  assert.equal(total(result), 12000)
  assert.deepEqual(value, before)
})

test('an independent denominator must bound weights and reconcile complete coverage', () => {
  const value = evidence()
  value.accountDenominator = measurement('24', 'independent-account-total')
  assert.throws(() => previewDevelopmentAllocation(invoice, value), /exceed/)
  value.accountDenominator = measurement('100', 'independent-account-total')
  value.coverage = { status: 'complete-verified', reference: 'full-review' }
  assert.throws(() => previewDevelopmentAllocation(invoice, value), /reconcile exactly/)
  value.weights = [project('example-project', '100')]
  assert.equal(previewDevelopmentAllocation(invoice, value).unallocatedMinor, 0)
})

test('zero or absent measured bucket weights keep the full invoice unallocated', () => {
  for (const weights of [[], [project('example-project', '0')]]) {
    const value = evidence()
    value.weights = weights
    const result = previewDevelopmentAllocation(invoice, value)
    assert.equal(result.status, 'inactive')
    assert.equal(result.unallocatedMinor, 12000)
    assert.equal(result.unmeasuredWeight, '100')
    assert.match(result.reason, /No positive measured bucket weight/)
  }
  const value = evidence()
  value.weights = []
  value.accountDenominator = measurement('0', 'independent-account-total')
  assert.equal(previewDevelopmentAllocation(invoice, value).unallocatedMinor, 12000)
})

test('rounding is deterministic across order, includes residual and conserves tiny invoices', () => {
  const value = evidence()
  value.accountDenominator = measurement('3', 'independent-account-total')
  value.weights = [project('b', '1'), project('a', '1')]
  const one = previewDevelopmentAllocation({ ...invoice, grossMinor: 1 }, value)
  assert.deepEqual(one.projects, [{ projectId: 'a', minor: 1 }, { projectId: 'b', minor: 0 }])
  assert.equal(one.unallocatedMinor, 0)
  assert.equal(one.unmeasuredWeight, '1')
  const two = previewDevelopmentAllocation({ ...invoice, grossMinor: 2 }, value)
  assert.equal(total(two), 2)
  value.weights.reverse()
  assert.deepEqual(previewDevelopmentAllocation({ ...invoice, grossMinor: 1 }, value), one)
  value.weights = [project('a', '0'), project('b', '1')]
  assert.equal(previewDevelopmentAllocation({ ...invoice, grossMinor: 1 }, value).unallocatedMinor, 1)
})

test('integer conservation holds across bounded invoices, scales and large weights', () => {
  for (const grossMinor of [0, 1, 2, 3, 99, 12000, 2_000_000_000]) {
    for (const multiplier of [1n, 10n ** 25n]) {
      const value = evidence()
      value.accountDenominator = measurement((13n * multiplier).toString(), 'independent-account-total')
      value.weights = [
        project('a', (2n * multiplier).toString()),
        project('b', (3n * multiplier).toString()),
        { bucket: { kind: 'personal' }, measurement: measurement((4n * multiplier).toString(), 'personal-total') },
        { bucket: { kind: 'unassigned' }, measurement: measurement(multiplier.toString(), 'unassigned-total') },
      ]
      const result = previewDevelopmentAllocation({ ...invoice, grossMinor }, value)
      assert.equal(total(result), grossMinor)
      for (const minor of [...result.projects.map(row => row.minor), result.personalMinor, result.unassignedMinor, result.unallocatedMinor]) {
        assert.ok(Number.isSafeInteger(minor) && minor >= 0)
      }
      value.weights.reverse()
      assert.deepEqual(previewDevelopmentAllocation({ ...invoice, grossMinor }, value), result)
    }
  }
})

test('rejects invalid, missing, negative, fractional, unsafe and oversized weights', () => {
  for (const weight of [undefined, null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '-1', '1.2', '01', '', '1e3', '9'.repeat(31)]) {
    const value = evidence()
    assert.throws(() => previewDevelopmentAllocation(invoice, {
      ...value, weights: [{ ...value.weights[0], measurement: { ...value.weights[0].measurement, weight } }],
    }))
  }
  for (const grossMinor of [-1, 0.1, NaN, Infinity, 2_000_000_001]) {
    assert.throws(() => previewDevelopmentAllocation({ ...invoice, grossMinor }))
  }
  assert.throws(() => previewDevelopmentAllocation(invoice, null))
  assert.throws(() => previewDevelopmentAllocation(invoice, {}))
})

test('providers and accounts cannot be combined or inferred, including in denominator', () => {
  for (const change of [{ provider: 'codex' }, { provider: 'cursor' }, { accountRef: 'another-account' }]) {
    const value = evidence()
    const altered = { ...value.weights[0].measurement, scope: { ...scope, ...change } }
    assert.throws(() => previewDevelopmentAllocation(invoice, { ...value, weights: [{ ...value.weights[0], measurement: altered }] }))
    assert.throws(() => previewDevelopmentAllocation(invoice, { ...value, accountDenominator: altered }))
  }
})

test('rejects mixed currencies, partial dates, invalid dates and inconsistent measurement scales', () => {
  for (const change of [
    { currency: 'GBP' }, { periodStart: '2026-10-29' }, { periodEnd: '2026-11-29' },
    { periodEnd: '2026-02-30' }, { periodEnd: scope.periodStart },
  ]) {
    const value = evidence()
    value.weights[0].measurement.scope = { ...scope, ...change } as typeof scope
    assert.throws(() => previewDevelopmentAllocation(invoice, value))
  }
  const value = evidence()
  value.weights[0].measurement.decimalPlaces = 6
  assert.throws(() => previewDevelopmentAllocation(invoice, value), /one comparable value scale/)
})

test('cannot reuse bucket totals, evidence or project IDs disguised as special buckets', () => {
  const value = evidence()
  assert.throws(() => previewDevelopmentAllocation(invoice, { ...value, weights: [...value.weights, value.weights[0]] }), /one non-overlapping/)
  const other = project('another-project', '1')
  other.measurement.evidenceRef = value.weights[0].measurement.evidenceRef
  assert.throws(() => previewDevelopmentAllocation(invoice, { ...value, weights: [...value.weights, other] }), /same measured evidence/)
  assert.throws(() => previewDevelopmentAllocation(invoice, { ...value, accountDenominator: value.weights[0].measurement }), /independently measured/)
  value.weights = [project('personal', '25'), { bucket: { kind: 'personal' }, measurement: measurement('25', 'personal-total') }]
  const result = previewDevelopmentAllocation(invoice, value)
  assert.deepEqual(result.projects, [{ projectId: 'personal', minor: 3000 }])
  assert.equal(result.personalMinor, 3000)
})

test('unsupported inferred weights, unverified complete coverage and unreferenced review are rejected', () => {
  for (const basis of ['allowance-percentage', 'messages', 'raw-tokens', 'mixed-model-tokens']) {
    const value = evidence()
    assert.throws(() => previewDevelopmentAllocation(invoice, {
      ...value, weights: [{ ...value.weights[0], measurement: { ...value.weights[0].measurement, basis } }],
    }))
  }
  assert.throws(() => previewDevelopmentAllocation(invoice, { ...evidence(), review: { status: 'reviewed' } }))
  assert.throws(() => previewDevelopmentAllocation(invoice, { ...evidence(), coverage: { status: 'complete-verified' } }))
  assert.throws(() => previewDevelopmentAllocation(invoice, { ...evidence(), coverage: { status: 'complete' } }))
  assert.throws(() => previewDevelopmentAllocation(invoice, { ...evidence(), weights: Array(1001).fill(project('a', '1')) }))
  assert.throws(() => previewDevelopmentAllocation(invoice, { ...evidence(), apply: true }))
})
