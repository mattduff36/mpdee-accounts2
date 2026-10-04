import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COMPARISON_POLICY, ITRADER_KNOWN_PROJECT_SEED, LEDGER_START } from './comparison-policy'
import { decimalUnits } from './money'
import { presentProvisionalEstimate, provisionalComparisonEstimate, storedClockToIso, type EstimateEvent } from './provisional-estimate'

const asOf = '2026-10-04T20:00:00.000Z'
const fx = { currency: 'USD', date: '2026-09-01', rate: '0.80000000', source: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml' }

function event(patch: Partial<EstimateEvent> & Pick<EstimateEvent, 'sourceKey'>): EstimateEvent {
  return {
    provider: 'cursor', accountRef: 'acct', occurredAt: '2026-09-01T12:00:00.000Z', revision: 1, funding: 'included',
    nominalUnits: decimalUnits('10'), providerUnits: BigInt(0), currency: 'USD', quality: 'complete', attribution: 'mapped',
    ...patch,
  }
}

test('comparison prices included at 50 percent, on-demand at face value, and ignores stored markup and daily membership', () => {
  const estimate = provisionalComparisonEstimate({
    asOf,
    referenceQuotes: [fx],
    storedPolicies: [{
      scope: 'project', effectiveAt: '2026-08-01T00:00:00.000Z', effectiveUntil: null, billable: true,
      includedBaseBps: ITRADER_KNOWN_PROJECT_SEED.includedBaseBps, markupBps: ITRADER_KNOWN_PROJECT_SEED.markupBps,
      infrastructureMarkupBps: 0, vercelDailyPence: ITRADER_KNOWN_PROJECT_SEED.vercelDailyPence,
    }],
    events: [
      event({ sourceKey: 'included' }),
      event({ sourceKey: 'demand', funding: 'on-demand', nominalUnits: decimalUnits('12'), providerUnits: decimalUnits('10') }),
      event({ sourceKey: 'host', provider: 'vercel', funding: 'infrastructure', nominalUnits: null, providerUnits: decimalUnits('4'), currency: 'GBP' }),
      event({ sourceKey: 'vercel:membership:2026-09-01:0', provider: 'vercel', funding: 'infrastructure', nominalUnits: null, providerUnits: decimalUnits('0.38'), currency: 'GBP' }),
    ],
  })
  assert.equal(estimate.policyVersion, 'mpdee-comparison-policy-v1')
  assert.equal(estimate.ledgerStart, LEDGER_START)
  assert.equal(estimate.included.nativeCharge[0].units, decimalUnits('5'))
  assert.equal(estimate.onDemand.nativeCharge[0].units, decimalUnits('10'))
  assert.equal(estimate.infrastructure.nativeCharge[0].units, decimalUnits('4'))
  assert.equal(estimate.comparison.gbp.pence, 400 + 800 + 400)
  assert.equal(estimate.comparison.gbp.estimate, true)
  assert.equal(estimate.comparison.gbp.partial, false)
  assert.equal(estimate.storedPolicy?.dailyMembershipApplied, false)
  assert.equal(estimate.storedPolicy?.nativeCharge.find(amount => amount.currency === 'USD')?.units, decimalUnits('6') + decimalUnits('11'))
  assert.equal(estimate.storedPolicy?.gbp.pence, 480 + 880 + 400)
  assert.notEqual(estimate.storedPolicy?.gbp.pence, 480 + 880 + 400 + 38)
  assert.equal(estimate.exclusions.find(bucket => bucket.key === 'membership')?.rows, 1)
  assert.equal(COMPARISON_POLICY.markupBps, 0)
  assert.equal(COMPARISON_POLICY.vercelDailyPence, 0)
  const presented = presentProvisionalEstimate(estimate, { infrastructureRowsInDatabase: 1 })
  assert.equal(presented.title, 'Provisional iTrader comparison charge')
  assert.match(presented.pricing.join(' '), /No markup/)
  assert.match(presented.pricing.join(' '), /No daily membership allocation/)
  assert.equal(presented.storedPolicy?.label, 'Stored policy client estimate')
})

test('unknown funding, free credit, held rows and unassigned work stay out of the charge with separate labels', () => {
  const estimate = provisionalComparisonEstimate({
    asOf,
    referenceQuotes: [fx],
    events: [
      event({ sourceKey: 'priced' }),
      event({ sourceKey: 'unknown', funding: 'unknown', nominalUnits: decimalUnits('2'), providerUnits: decimalUnits('1.5'), quality: 'review' }),
      event({ sourceKey: 'credit', funding: 'free-credit', nominalUnits: decimalUnits('3'), providerUnits: decimalUnits('0.25') }),
      event({ sourceKey: 'held', quality: 'review', nominalUnits: decimalUnits('7'), providerUnits: decimalUnits('0') }),
      event({ sourceKey: 'loose', attribution: 'unassigned', nominalUnits: decimalUnits('9') }),
      event({ sourceKey: 'manual', attribution: 'manual', nominalUnits: decimalUnits('4'), providerUnits: BigInt(0) }),
    ],
  })
  assert.equal(estimate.included.nativeCharge[0].units, decimalUnits('7'))
  assert.equal(estimate.comparison.nativeCharge[0].units, decimalUnits('7'))
  const unknown = estimate.exclusions.find(bucket => bucket.key === 'unknown-funding')
  const credit = estimate.exclusions.find(bucket => bucket.key === 'free-credit')
  assert.equal(unknown?.rows, 1)
  assert.equal(unknown?.label, 'Unknown funding')
  assert.equal(unknown?.recordedProvider[0].units, decimalUnits('1.5'))
  assert.equal(credit?.rows, 1)
  assert.equal(credit?.label, 'Free-credit funding')
  assert.notEqual(unknown?.label, credit?.label)
  assert.equal(estimate.exclusions.find(bucket => bucket.key === 'held')?.rows, 1)
  assert.equal(estimate.exclusions.find(bucket => bucket.key === 'not-attributed')?.rows, 1)
  assert.match(presentProvisionalEstimate(estimate).exclusions.map(line => line.label).join('|'), /Unknown funding\|Free-credit funding\|Held for review/)
})

test('latest revision is used, earlier events stay outside the boundary, and duplicates are not summed', () => {
  const estimate = provisionalComparisonEstimate({
    asOf,
    referenceQuotes: [fx],
    events: [
      event({ sourceKey: 'same', revision: 1, nominalUnits: decimalUnits('10') }),
      event({ sourceKey: 'same', revision: 2, nominalUnits: decimalUnits('4'), revisionAt: '2026-10-04T18:54:26.000Z' }),
      event({ sourceKey: 'early', occurredAt: '2026-08-13T22:59:59.000Z', nominalUnits: decimalUnits('80') }),
      event({ sourceKey: 'boundary', occurredAt: LEDGER_START, nominalUnits: decimalUnits('2') }),
    ],
  })
  assert.equal(estimate.comparison.duplicateRevisions, 1)
  assert.equal(estimate.included.nativeCharge[0].units, decimalUnits('2') + decimalUnits('1'))
  assert.equal(estimate.exclusions.find(bucket => bucket.key === 'before-ledger')?.rows, 1)
  assert.equal(estimate.firstAt, LEDGER_START)
  assert.equal(estimate.latestRevisionAt, '2026-10-04T18:54:26.000Z')
  assert.equal(storedClockToIso('2026-08-13 23:00:00'), LEDGER_START)
})

test('currencies stay apart, missing FX is not zero, and a partial GBP subtotal keeps the native amount', () => {
  const missing = provisionalComparisonEstimate({
    asOf,
    events: [event({ sourceKey: 'no-rate', funding: 'on-demand', providerUnits: decimalUnits('3'), nominalUnits: decimalUnits('3') })],
  })
  assert.equal(missing.comparison.gbp.pence, null)
  assert.equal(missing.onDemand.nativeCharge[0].units, decimalUnits('3'))
  assert.match(presentProvisionalEstimate(missing).headline, /Unavailable/)
  const split = provisionalComparisonEstimate({
    asOf,
    referenceQuotes: [fx],
    events: [
      event({ sourceKey: 'usd', funding: 'on-demand', providerUnits: decimalUnits('4'), nominalUnits: decimalUnits('4') }),
      event({ sourceKey: 'eur', provider: 'vercel', funding: 'infrastructure', currency: 'EUR', nominalUnits: null, providerUnits: decimalUnits('2') }),
    ],
  })
  assert.equal(split.comparison.gbp.partial, true)
  assert.equal(split.comparison.gbp.pence, 320)
  assert.deepEqual(split.comparison.nativeCharge.map(amount => amount.currency), ['EUR', 'USD'])
  assert.equal(split.comparison.nativeCharge.find(amount => amount.currency === 'USD')?.units, decimalUnits('4'))
  assert.equal(split.comparison.nativeCharge.find(amount => amount.currency === 'EUR')?.units, decimalUnits('2'))
  assert.match(presentProvisionalEstimate(split).headline, /partial/)
})

test('daily GBP rounding is once per day, infrastructure credits reduce the charge, and a covered invoice is not added twice', () => {
  const small = Array.from({ length: 100 }, (_, index) => event({
    sourceKey: `small-${index}`, funding: 'on-demand', nominalUnits: decimalUnits('0.004'), providerUnits: decimalUnits('0.004'),
  }))
  const rounded = provisionalComparisonEstimate({ asOf, referenceQuotes: [{ ...fx, rate: '0.75000000' }], events: small })
  assert.equal(rounded.comparison.gbp.pence, 30)
  const credit = provisionalComparisonEstimate({
    asOf,
    events: [
      event({ sourceKey: 'use', provider: 'vercel', funding: 'infrastructure', currency: 'GBP', nominalUnits: null, providerUnits: decimalUnits('1.25') }),
      event({ sourceKey: 'credit', provider: 'vercel', funding: 'infrastructure', currency: 'GBP', nominalUnits: null, providerUnits: decimalUnits('-0.25') }),
      event({ sourceKey: 'billed', funding: 'on-demand', providerUnits: decimalUnits('2'), nominalUnits: decimalUnits('2'), coveredByProviderInvoice: true, recordedFx: '0.80000000' }),
    ],
  })
  assert.equal(credit.infrastructure.nativeCharge[0].units, decimalUnits('1'))
  assert.equal(credit.infrastructure.gbp.pence, 100)
  assert.equal(credit.comparison.coveredByProviderInvoiceRows, 1)
  assert.equal(credit.onDemand.gbp.pence, 160)
  assert.equal(credit.comparison.gbp.pence, 260)
})

test('missing infrastructure is not a zero cost, and local infrastructure stays labelled local', () => {
  const live = provisionalComparisonEstimate({
    asOf,
    referenceQuotes: [fx],
    events: [event({ sourceKey: 'cursor-only' })],
  })
  assert.equal(live.infrastructure.rows, 0)
  assert.equal(live.infrastructure.provenance, 'absent')
  assert.equal(live.comparison.infrastructureIncluded, false)
  assert.equal(live.comparison.gbp.pence, 400)
  const presented = presentProvisionalEstimate(live, { infrastructureRowsInDatabase: 0 })
  assert.equal(presented.lines.find(line => line.label === 'Infrastructure')?.value, 'Missing')
  assert.match(presented.note, /not a verified £0/)
  assert.doesNotMatch(presented.headline, /£0\.00/)
  const local = provisionalComparisonEstimate({
    asOf,
    referenceQuotes: [fx],
    events: [
      event({ sourceKey: 'cursor-only' }),
      event({ sourceKey: 'bucket:0', provider: 'vercel', funding: 'infrastructure', nominalUnits: null, providerUnits: decimalUnits('1'), currency: 'USD', provenance: 'local-shadow', occurredAt: '2026-10-02T07:00:00.000Z', recordedFx: '0.80000000' }),
    ],
  })
  assert.equal(local.included.gbp.pence, live.included.gbp.pence)
  assert.equal(local.onDemand.gbp.pence, live.onDemand.gbp.pence)
  assert.equal(local.infrastructure.provenance, 'local-shadow')
  assert.equal(local.comparison.gbp.pence, 400 + 80)
  assert.match(presentProvisionalEstimate(local).note, /local shadow evidence only/)
  assert.match(presentProvisionalEstimate(local).note, /07:00/)
})

test('a database resource already billed through Vercel is not charged a second time', () => {
  const estimate = provisionalComparisonEstimate({
    asOf,
    events: [
      event({ sourceKey: 'vercel-db:0', provider: 'vercel', funding: 'infrastructure', currency: 'GBP', nominalUnits: null, providerUnits: decimalUnits('2'), resourceRef: 'db-1' }),
      event({ sourceKey: 'supabase-db:0', provider: 'supabase', funding: 'infrastructure', currency: 'GBP', nominalUnits: null, providerUnits: decimalUnits('2'), resourceRef: 'db-1' }),
    ],
  })
  assert.equal(estimate.infrastructure.nativeCharge[0].units, decimalUnits('2'))
  assert.equal(estimate.exclusions.find(bucket => bucket.key === 'database-already-billed')?.rows, 1)
})
