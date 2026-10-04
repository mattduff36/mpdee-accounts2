import assert from 'node:assert/strict'
import test from 'node:test'
import { decimalUnits } from './money'
import { eventViews, outstandingBalance } from './four-views'
import { projectComparison } from './comparison-snapshot'
import { LEDGER_START } from './comparison-policy'

const fx = { rate: '0.75', date: '2026-09-26', source: 'test' }
const event = {
  id: 'event-1', provider: 'cursor', funding: 'included', nominalUnits: decimalUnits('10'), providerUnits: BigInt(0), currency: 'USD',
  quality: 'complete', attribution: 'mapped', hold: null, coveredByProviderInvoice: false, fx,
}

test('included zero provider cash is not a free subscription and is priced at 50 percent', () => {
  const views = eventViews(event)
  assert.equal(views.includedCashIsNotSubscription, true)
  assert.equal(views.providerCost, null)
  assert.equal(views.usageValue, decimalUnits('10'))
  assert.equal(views.clientCharge, decimalUnits('5'))
  assert.equal(views.clientChargePence, BigInt(375))
})

test('on-demand client charge is the provider cash without the stored 10 point addition', () => {
  const views = eventViews({ ...event, funding: 'on-demand', providerUnits: decimalUnits('10'), nominalUnits: decimalUnits('12') })
  assert.equal(views.providerCost, decimalUnits('10'))
  assert.equal(views.clientCharge, decimalUnits('10'))
  assert.equal(views.usageValue, decimalUnits('12'))
})

test('a provider invoice suppresses usage as an expense and still leaves the client charge', () => {
  const views = eventViews({ ...event, funding: 'on-demand', providerUnits: decimalUnits('10'), coveredByProviderInvoice: true })
  assert.equal(views.providerCost, null)
  assert.equal(views.clientCharge, decimalUnits('10'))
  assert.match(views.reason ?? '', /provider invoice/)
})

test('conflicting attribution, missing FX and negative infrastructure credits stay distinct', () => {
  const conflict = eventViews({ ...event, attribution: 'conflict' })
  assert.equal(conflict.clientCharge, null)
  assert.equal(conflict.usageValue, decimalUnits('10'))
  assert.equal(conflict.providerCost, null)
  assert.match(conflict.reason ?? '', /conflict/)
  const unassignedInfra = eventViews({ ...event, provider: 'vercel', funding: 'infrastructure', attribution: 'unassigned', nominalUnits: null, providerUnits: decimalUnits('3'), currency: 'USD' })
  assert.equal(unassignedInfra.providerCost, decimalUnits('3'))
  assert.equal(unassignedInfra.clientCharge, null)
  const missingFx = eventViews({ ...event, funding: 'on-demand', providerUnits: decimalUnits('2'), fx: null })
  assert.equal(missingFx.clientCharge, decimalUnits('2'))
  assert.equal(missingFx.clientChargePence, null)
  assert.equal(missingFx.reason, 'Missing FX')
  const credit = eventViews({ ...event, provider: 'vercel', funding: 'infrastructure', nominalUnits: null, providerUnits: decimalUnits('-1.25'), currency: 'GBP', fx: { rate: '1', date: '2026-09-01', source: 'identity' } })
  assert.equal(credit.providerCost, decimalUnits('-1.25'))
  assert.equal(credit.clientCharge, decimalUnits('-1.25'))
  assert.equal(credit.usageValue, null)
})

test('comparison totals keep currencies apart and omit events before the ledger start', () => {
  const documents = { providerInvoicePence: null, providerCreditPence: null, customerCreditPence: null, customerPaymentPence: null, vatPence: null, prepaidPence: null }
  const base = { accountRef: 'acct', sourceKey: 's', projectId: 'p', ...event, occurredAt: new Date('2026-09-01T12:00:00.000Z') }
  const result = projectComparison({
    project: 'itrader', asOf: new Date('2026-09-02T00:00:00.000Z'), events: [
      base,
      { ...base, id: 'early', sourceKey: 'early', occurredAt: new Date('2026-08-13T22:00:00.000Z') },
      { ...base, id: 'host', sourceKey: 'host', provider: 'vercel', funding: 'infrastructure', nominalUnits: null, providerUnits: decimalUnits('3'), currency: 'GBP', fx: { rate: '1', date: '2026-09-01', source: 'identity' } },
    ],
    sourceUpdatedAt: null, storedPolicies: null, documents, approvedClientChargePence: null,
  })
  assert.equal(result.coverage.events, 2)
  assert.equal(result.coverage.from, LEDGER_START)
  assert.equal(result.authoritativeWriter, 'itrader')
  assert.equal(result.approvedSnapshot, false)
  assert.equal(result.lines.every(line => line.invoiceability === 'PROVISIONAL'), true)
  assert.deepEqual(result.totals.map(total => total.currency), ['GBP', 'USD'])
  assert.equal(result.outstanding.pence, null)
  assert.equal(result.zeroProviderCashIncluded, 1)
})

test('known subtotals stay visible beside unresolved rows and reference rates stay estimates', () => {
  const documents = { providerInvoicePence: null, providerCreditPence: null, customerCreditPence: null, customerPaymentPence: null, vatPence: null, prepaidPence: null }
  const base = { accountRef: 'acct', sourceKey: 'known', projectId: 'p', ...event, id: 'known', occurredAt: new Date('2026-09-26T12:00:00.000Z'), funding: 'on-demand', providerUnits: decimalUnits('4'), nominalUnits: decimalUnits('4') }
  const result = projectComparison({
    project: 'itrader', asOf: new Date('2026-09-27T00:00:00.000Z'), events: [
      base,
      { ...base, id: 'open', sourceKey: 'open', attribution: 'unassigned', fx: null },
    ],
    sourceUpdatedAt: null, storedPolicies: null, documents, approvedClientChargePence: null,
    referenceQuotes: [{ currency: 'USD', date: '2026-09-25', rate: '0.75000000', source: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml' }],
  })
  const usd = result.totals.find(total => total.currency === 'USD')
  assert.equal(usd?.usageValue, '8.0000000')
  assert.equal(usd?.providerCost, '8.0000000')
  assert.equal(usd?.clientCharge, '4.0000000')
  assert.equal(usd?.complete, false)
  assert.equal(usd?.unresolved.usageEvents, 0)
  assert.equal(usd?.unresolved.chargeEvents, 1)
  assert.equal(usd?.unresolved.providerEvents, 0)
  assert.equal(result.coverage.overlap.unassignedAndHeld, 1)
  assert.equal(result.coverage.overlap.heldAndFx, 0)
  assert.equal(result.lines.find(line => line.funding === 'on-demand' && line.fx[0]?.estimate)?.fx[0]?.estimate, true)
})

test('outstanding balance uses approved charges, payments and credits, not estimates', () => {
  const documents = { providerInvoicePence: 900, providerCreditPence: -100, customerCreditPence: 3000, customerPaymentPence: 4000, vatPence: 400, prepaidPence: null }
  assert.equal(outstandingBalance({ approvedClientChargePence: null, documents }).outstandingPence, null)
  assert.equal(outstandingBalance({ approvedClientChargePence: 8000, documents }).outstandingPence, 1000)
})
