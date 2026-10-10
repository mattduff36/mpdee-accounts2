import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decimalUnits } from './money'
import { provisionalComparisonEstimate, type EstimateEvent, type ProvisionalEstimate } from './provisional-estimate'
import { projectCostSummary } from './project-summary'

const asOf = '2026-10-04T20:00:00.000Z'
const fx = { currency: 'USD', date: '2026-09-01', rate: '0.80000000', source: 'test-reference' }

function event(patch: Partial<EstimateEvent> & Pick<EstimateEvent, 'sourceKey'>): EstimateEvent {
  return {
    provider: 'cursor', accountRef: 'acct', occurredAt: '2026-09-01T12:00:00.000Z', revision: 1,
    revisionAt: '2026-09-02T08:00:00.000Z', funding: 'included', nominalUnits: decimalUnits('10'),
    providerUnits: BigInt(0), currency: 'USD', quality: 'complete', attribution: 'mapped', model: 'claude-4.6-sonnet',
    ...patch,
  }
}

function summarize(estimate: ProvisionalEstimate, patch: Partial<Parameters<typeof projectCostSummary>[0]> = {}) {
  return projectCostSummary({
    project: 'acme',
    estimate,
    comparisonRevision: 'comparison-rev-1',
    outstanding: { pence: null, reason: 'No approved client charges' },
    ...patch,
  })
}

test('summary passes through central estimate pence and keeps native units out of JSON', () => {
  const estimate = provisionalComparisonEstimate({
    asOf,
    referenceQuotes: [fx],
    events: [
      event({ sourceKey: 'included' }),
      event({ sourceKey: 'demand', funding: 'on-demand', nominalUnits: decimalUnits('12'), providerUnits: decimalUnits('10') }),
      event({ sourceKey: 'host', provider: 'vercel', funding: 'infrastructure', nominalUnits: null, providerUnits: decimalUnits('4'), currency: 'GBP', provenance: 'live' }),
    ],
    extraExclusions: [{
      key: 'unassigned-cursor', label: 'Unassigned Cursor usage', rows: 2,
      nominal: [{ currency: 'USD', units: decimalUnits('9'), rows: 2 }], recordedProvider: [],
      reason: 'Unassigned Cursor usage stays out of the iTrader charge.',
    }],
  })
  const summary = summarize(estimate)
  assert.equal(summary.version, 'mpdee-project-cost-summary-v1')
  assert.equal(summary.project, 'acme')
  assert.equal(summary.source, 'mpdee-accounts')
  assert.equal(summary.approvedSnapshot, false)
  assert.equal(summary.currency, 'GBP')
  assert.equal(summary.estimate.totalPence, estimate.comparison.gbp.pence)
  assert.equal(summary.estimate.includedPence, estimate.included.gbp.pence)
  assert.equal(summary.estimate.onDemandPence, estimate.onDemand.gbp.pence)
  assert.equal(summary.estimate.infrastructurePence, estimate.infrastructure.gbp.pence)
  assert.equal(summary.estimate.totalPence, 400 + 800 + 400)
  assert.equal(summary.estimate.partial, false)
  assert.equal(summary.estimate.fxEstimated, true)
  assert.equal(summary.coverage.infrastructureStatus, 'live')
  assert.equal(summary.coverage.includedRows, 1)
  assert.equal(summary.sourceUpdatedAt, '2026-09-02T08:00:00.000Z')
  assert.notEqual(summary.sourceUpdatedAt, summary.asOf)
  const text = summary.pricing.join('\n')
  assert.match(text, /Included premium Cursor is 50%/)
  assert.match(text, /Included Grok and Composer are 0%/)
  assert.match(text, /All on-demand Cursor is 100%/)
  assert.match(text, /face value/)
  assert.match(text, /No markup/)
  assert.match(text, /No daily membership/)
  assert.match(text, /dated rate/)
  assert.match(text, /estimates, not bank-settled GBP/)
  const unassigned = summary.coverage.exclusions.find(bucket => bucket.key === 'unassigned-cursor')
  assert.equal(unassigned?.reason, 'Unassigned Cursor usage stays out of the project charge.')
  assert.equal(JSON.stringify(summary).includes('iTrader'), false)
  const serialized = JSON.stringify(summary)
  assert.equal(serialized.includes('90000000'), false)
  assert.deepEqual(JSON.parse(serialized).estimate, summary.estimate)
})

test('null stays distinct from zero, negatives pass through, and unsafe pence are rejected', () => {
  const estimate = provisionalComparisonEstimate({
    asOf,
    events: [event({ sourceKey: 'grok', model: 'cursor-grok-4', currency: 'GBP', nominalUnits: decimalUnits('8') })],
  })
  const zeroIncluded = summarize(estimate, { outstanding: { pence: 0, reason: null } })
  assert.equal(zeroIncluded.estimate.includedPence, 0)
  assert.equal(zeroIncluded.estimate.totalPence, 0)
  assert.equal(zeroIncluded.estimate.onDemandPence, null)
  assert.equal(zeroIncluded.estimate.infrastructurePence, null)
  assert.equal(zeroIncluded.coverage.infrastructureStatus, 'absent')
  assert.equal(zeroIncluded.estimate.partial, true, 'missing infrastructure makes the zero a supported subtotal')
  assert.equal(zeroIncluded.outstanding.pence, 0)
  const unapproved = summarize(estimate)
  assert.equal(unapproved.outstanding.pence, null)
  assert.equal(unapproved.outstanding.reason, 'No approved client charges')
  estimate.included.gbp.pence = -15
  estimate.comparison.gbp.pence = -15
  const negative = summarize(estimate, { outstanding: { pence: -250, reason: null } })
  assert.equal(negative.estimate.includedPence, -15)
  assert.equal(negative.estimate.totalPence, -15)
  assert.equal(negative.outstanding.pence, -250)
  estimate.comparison.gbp.pence = 1.5
  assert.throws(() => summarize(estimate), /safe integer/)
  estimate.comparison.gbp.pence = -15
  assert.throws(() => summarize(estimate, { outstanding: { pence: Number.MAX_SAFE_INTEGER + 1, reason: null } }), /safe integer/)
})

test('revision ignores the request clock and changes with source, comparison and pricing', () => {
  const estimate = provisionalComparisonEstimate({
    asOf,
    referenceQuotes: [fx],
    events: [event({ sourceKey: 'included' })],
  })
  const first = summarize(estimate)
  estimate.asOf = '2026-10-10T19:00:00.000Z'
  const laterClock = summarize(estimate)
  assert.equal(laterClock.asOf, '2026-10-10T19:00:00.000Z')
  assert.equal(laterClock.revision, first.revision)
  estimate.latestRevisionAt = '2026-10-09T01:00:00.000Z'
  const revisedSource = summarize(estimate)
  assert.equal(revisedSource.sourceUpdatedAt, '2026-10-09T01:00:00.000Z')
  assert.notEqual(revisedSource.revision, first.revision)
  const revisedComparison = summarize(estimate, { comparisonRevision: 'comparison-rev-2' })
  assert.notEqual(revisedComparison.revision, revisedSource.revision)
  estimate.comparison.duplicateRevisions = 4
  const revisedPricing = summarize(estimate, { comparisonRevision: 'comparison-rev-2' })
  assert.match(revisedPricing.pricing.join('\n'), /4 older revisions/)
  assert.notEqual(revisedPricing.revision, revisedComparison.revision)
  estimate.exclusions.push({
    key: 'not-attributed', label: 'Not explicitly attributed', rows: 1, nominal: [], recordedProvider: [],
    reason: 'Unassigned and conflicting rows stay out of the iTrader charge.',
  })
  const named = summarize(estimate, { project: 'itrader', comparisonRevision: 'comparison-rev-2' })
  assert.match(named.coverage.exclusions.find(bucket => bucket.key === 'not-attributed')?.reason ?? '', /iTrader/)
  const neutral = summarize(estimate, { project: 'acme', comparisonRevision: 'comparison-rev-2' })
  assert.equal(neutral.coverage.exclusions.find(bucket => bucket.key === 'not-attributed')?.reason, 'Unassigned and conflicting rows stay out of the project charge.')
})

test('known unresolved project rows mark the summary partial even with infrastructure and complete FX', () => {
  const estimate = provisionalComparisonEstimate({ asOf, events: [
    event({ sourceKey: 'host', provider: 'vercel', funding: 'infrastructure', providerUnits: decimalUnits('4'), currency: 'GBP', provenance: 'live' }),
    event({ sourceKey: 'unclear', funding: 'unknown', currency: 'GBP' }),
  ] })
  assert.equal(estimate.comparison.gbp.partial, false)
  const summary = summarize(estimate)
  assert.equal(summary.estimate.totalPence, 400)
  assert.equal(summary.estimate.partial, true)
  assert.equal(summary.estimate.fxMissingRows, 0)
  assert.equal(summary.coverage.exclusions.find(bucket => bucket.key === 'unknown-funding')?.rows, 1)
})
