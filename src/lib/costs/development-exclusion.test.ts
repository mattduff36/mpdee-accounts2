import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { legacyProviderFilter } from './providers'
import { chargeUnits, decimalUnits } from './money'
import { COMPARISON_POLICY } from './comparison-policy'
import { isConfirmedProviderCash } from './charge-eligibility'
import { eventViews } from './four-views'
import { projectComparison } from './comparison-snapshot'
import { projectSnapshot } from './project-snapshot'
import { groupSourceUsage, summariseProjects, type UsageGroup } from './figures'
import { aggregateCostReport } from './report-aggregation'
import { provisionalComparisonEstimate } from './provisional-estimate'

const date = new Date('2026-10-12T12:00:00Z')
const amount = decimalUnits('10')

test('development providers cannot enter charge, cash, overview, chart, comparison or project snapshot totals, even with complete/paid data', () => {
  for (const provider of ['openai', 'codex']) {
    for (const funding of ['paid', 'infrastructure', 'on-demand', 'included', 'free-credit']) {
      assert.equal(chargeUnits({ provider, funding, nominal: amount, cash: amount }, COMPARISON_POLICY), null)
      assert.equal(chargeUnits({ provider, funding, nominal: amount, cash: amount }, { ...COMPARISON_POLICY, billable: false }), null)
      assert.equal(isConfirmedProviderCash(provider, funding), false)
    }
    const event = {
      id: provider, provider, funding: 'infrastructure', nominalUnits: amount, providerUnits: amount, currency: 'GBP',
      quality: 'complete', attribution: 'mapped', hold: null, coveredByProviderInvoice: false,
      fx: { rate: '1', date: '2026-10-12', source: 'test' },
      accountRef: 'account', sourceKey: 'source:0', occurredAt: date, projectId: 'project',
    }
    const view = eventViews(event)
    assert.equal(view.providerCost, null)
    assert.equal(view.usageValue, null)
    assert.equal(view.clientCharge, null)
    const comparison = projectComparison({
      project: 'project', asOf: date, events: [event], sourceUpdatedAt: null, storedPolicies: null, approvedClientChargePence: null,
      documents: { providerInvoicePence: null, providerCreditPence: null, prepaidPence: null, customerPaymentPence: null, customerCreditPence: null, vatPence: null },
    })
    assert.deepEqual(comparison.totals, [])
    assert.deepEqual(comparison.lines, [])
    assert.equal(comparison.coverage.events, 0)
    const provisional = provisionalComparisonEstimate({ asOf: date.toISOString(), events: [{ ...event, revision: 1, occurredAt: date.toISOString() }] })
    assert.deepEqual(provisional.infrastructure.nativeCharge, [])
    assert.deepEqual(provisional.comparison.nativeCharge, [])
    const snapshot = projectSnapshot('project', [{
      event, revision: { ...event, id: 'r', revision: 1, checksum: 'test', createdAt: date },
      policy: { ...COMPARISON_POLICY, id: 'policy', effectiveAt: date }, hold: null, fx: { ...event.fx, currency: 'GBP' },
    }], date)
    assert.deepEqual(snapshot.lines, [])
    assert.equal(snapshot.coverage.events, 0)
    const group: UsageGroup = {
      slug: 'project', name: 'Project', provider, funding: 'infrastructure', currency: 'GBP', quality: 'complete', assigned: true,
      model: null, sourceKey: 'source:0', coveredByProviderInvoice: false, rows: 1, nominalUnits: amount, providerUnits: amount,
    }
    assert.deepEqual(groupSourceUsage([group]), [])
    assert.deepEqual(summariseProjects([group], [], []), [])
    const chart = aggregateCostReport([{
      date: '2026-10-12', projectId: 'project', projectName: 'Project', provider, funding: 'infrastructure',
      nominal: amount, providerCash: amount, estimate: amount, held: false,
    }])
    assert.equal(chart.totals.events, 0)
    assert.equal(chart.totals.providerCash, BigInt(0))
    assert.deepEqual(chart.daily, [])
  }
  assert.equal(chargeUnits({ provider: 'vercel', funding: 'infrastructure', nominal: amount, cash: amount }, COMPARISON_POLICY), amount)
})

test('all unqualified financial database read paths exclude development before limits and FX', () => {
  assert.deepEqual(legacyProviderFilter(), { notIn: ['openai', 'codex'] })
  const root = 'src\\lib\\costs\\'
  for (const path of ['service.ts', 'comparison-load.ts', 'project-snapshot-load.ts', 'period-usage-load.ts']) {
    const source = readFileSync(root + path, 'utf8')
    assert.match(source, /provider: legacyProviderFilter\(\)/, path)
  }
  for (const path of ['figures-load.ts', 'provisional-load.ts']) {
    assert.match(readFileSync(root + path, 'utf8'), /e\.provider NOT IN \(\$\{Prisma\.join\(DEVELOPMENT_PROVIDERS\)\}\)/, path)
  }
})
