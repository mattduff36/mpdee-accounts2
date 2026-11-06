import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { developmentResponse } from './development-api'
import { buildDevelopmentReport, DevelopmentReportError, type DevelopmentQuery } from './development-report'
import { middleware } from '../../../middleware'

const token = 'synthetic-test-token-not-a-secret-123456789'
const request = (suffix = '', authorization?: string) => new NextRequest(`http://localhost/api/costs/development${suffix}`, { headers: authorization ? { authorization } : {} })
const load = async (query: DevelopmentQuery) => buildDevelopmentReport([], query)

test('development GET rejects anonymous/invalid-token reads before loading and accepts normal readonly sessions', async () => {
  let reads = 0
  const deps = { token, sessionUser: async () => null, load: async (query: DevelopmentQuery) => { reads++; return load(query) } }
  assert.equal((await developmentResponse(request(), deps)).status, 401)
  assert.equal((await developmentResponse(request('', 'Bearer wrong'), deps)).status, 401)
  assert.equal(reads, 0)
  const reader = await developmentResponse(request(), { ...deps, sessionUser: async () => ({ role: 'readonly' }) })
  assert.equal(reader.status, 200)
  assert.equal(reader.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(reads, 1)
})

test('existing ingest bearer grants read access without session or writes', async () => {
  const response = await developmentResponse(request('?from=2026-10-01&to=2026-11-01&projectId=unassigned', `Bearer ${token}`), {
    token, sessionUser: async () => { throw new Error('Machine reads must not access session users') }, load,
  })

  assert.equal(response.status, 200)
  const report = await response.json()
  assert.equal(report.projectId, 'unassigned')
  assert.deepEqual(report.providerDailyAggregates.totals, [])
  assert.deepEqual(report.taskMeasurements.totals, [])
})

test('middleware reaches development GET auth without a cookie but does not open writes or neighbouring routes', () => {
  assert.equal(middleware(request()).headers.get('x-middleware-next'), '1')
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = middleware(new NextRequest('http://localhost/api/costs/development', { method }))
    assert.equal(response.status, 307)
    assert.equal(response.headers.get('location'), 'http://localhost/login')
  }
  assert.equal(middleware(new NextRequest('http://localhost/api/costs/development/extra')).status, 307)
  assert.equal(middleware(new NextRequest('http://localhost/costs/development')).status, 307)
})

test('invalid, repeated, unknown parameters and query overflow are explicit errors, not partial success', async () => {
  const deps = { token: undefined, sessionUser: async () => ({ role: 'readonly' }), load }
  for (const suffix of ['?from=2026-02-30', '?from=2026-10-01&from=2026-10-02', '?rawEvidence=true', '?from=2024-01-01&to=2026-01-01']) {
    assert.equal((await developmentResponse(request(suffix), deps)).status, 400)
  }
  const overflow = await developmentResponse(request(), { ...deps, load: async () => { throw new DevelopmentReportError('Development report exceeds 50000 events', 422) } })
  assert.equal(overflow.status, 422)
  assert.match((await overflow.json()).error, /50000/)
})
