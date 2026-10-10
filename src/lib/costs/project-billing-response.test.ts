import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import * as billingRoute from '../../app/api/costs/projects/[slug]/billing/route'
import { GET as getSnapshot } from '../../app/api/costs/projects/[slug]/snapshot/route'
import { LEDGER_START } from './comparison-policy'
import { buildProjectBilling } from './project-billing'
import type { ProjectBillingLoad } from './project-billing-load'
import { getProjectBilling } from './project-billing-response'
import { projectSnapshot } from './project-snapshot'

const envKey = 'COSTS_PROJECT_READ_TOKEN_SHA256_BY_SLUG'

function request(slug: string, authorization?: string) {
  return new NextRequest(`http://localhost/api/costs/projects/${slug}/billing`, authorization ? { headers: { authorization } } : undefined)
}

test('billing and snapshot routes use private no-store auth and generic failures', async () => {
  const previous = process.env[envKey]
  delete process.env[envKey]
  let loaded = false
  try {
    const invalid = await getProjectBilling(request('nope'), { params: { slug: 'Bad Slug' } })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual(await invalid.json(), { error: 'Invalid project' })

    const unconfigured = await getProjectBilling(request('itrader'), { params: { slug: 'itrader' } }, { load: async () => { loaded = true; throw new Error('unused') } })
    assert.equal(unconfigured.status, 503)
    assert.equal(loaded, false)
    assert.deepEqual(await unconfigured.json(), { error: 'Project read access is not configured' })

    process.env[envKey] = JSON.stringify({ itrader: 'ab'.repeat(32) })
    const denied = await getProjectBilling(request('itrader', 'Bearer nope'), { params: { slug: 'itrader' } }, { load: async () => { loaded = true; throw new Error('unused') } })
    assert.equal(denied.status, 401)
    assert.equal(loaded, false)
    assert.equal(denied.headers.get('cache-control'), 'private, no-store')

    const snapshotDenied = await getSnapshot(request('itrader', 'Bearer nope'), { params: { slug: 'itrader' } })
    assert.equal(snapshotDenied.status, 401)
    assert.equal(snapshotDenied.headers.get('cache-control'), 'private, no-store')
    const snapshotInvalid = await getSnapshot(request('x'), { params: { slug: 'UPPER' } })
    assert.equal(snapshotInvalid.status, 400)

    const failed = await getProjectBilling(request('itrader'), { params: { slug: 'itrader' } }, {
      authorize: () => true,
      load: async () => { throw new Error('postgres://user:password@internal/db') },
    })
    assert.equal(failed.status, 500)
    assert.deepEqual(await failed.json(), { error: 'Project billing unavailable' })

    const secretInvoice = 'MPD-2026-032'
    const issuedAt = '2026-05-27T00:00:00.000Z'
    const asOf = new Date('2026-10-10T12:00:00.000Z')
    const built = buildProjectBilling({
      projectSlug: 'itrader', projectId: 'project-1', clientId: 'client-1', asOf,
      snapshot: projectSnapshot('itrader', [], asOf, [], LEDGER_START),
      invoices: [{ id: 'inv_secret', invoiceNumber: secretInvoice, clientId: 'client-1', status: 'paid', issueDate: new Date(issuedAt), viewHidden: false, total: 50000, vatTotal: 0, creditNotes: [] }],
      associations: [{ invoiceId: 'inv_secret', projectId: 'project-1' }],
      mappings: [],
    })
    const billingLoad: ProjectBillingLoad = { status: 200, body: built.envelope, report: built.report }
    assert.equal(billingLoad.report?.[0].issueDate, issuedAt)
    assert.equal(billingLoad.report?.[0].status, 'paid')
    const ok = await getProjectBilling(request('itrader'), { params: { slug: 'itrader' } }, {
      authorize: () => true,
      load: async () => billingLoad,
    })
    const text = JSON.stringify(await ok.json())
    assert.equal(text.includes(secretInvoice), false)
    assert.equal(text.includes('inv_secret'), false)
    assert.equal(text.includes(issuedAt), false)
    assert.equal(text.includes('password'), false)
    assert.equal('getProjectBilling' in billingRoute, false)
    assert.equal(typeof billingRoute.GET, 'function')
    assert.equal(billingRoute.dynamic, 'force-dynamic')
    assert.equal(billingRoute.runtime, 'nodejs')
  } finally {
    if (previous === undefined) delete process.env[envKey]
    else process.env[envKey] = previous
  }
})
