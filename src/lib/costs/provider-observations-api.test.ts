import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { WriteAccessError } from '@/lib/auth'
import { middleware } from '../../../middleware'
import { handleProviderObservations, MAX_OBSERVATION_BYTES, type ProviderObservationDeps } from '@/app/api/costs/provider-observations/handler'
import {
  createProviderObservation, providerObservationReport, ProviderObservationError,
  type ProviderObservationStore, type ProviderObservationQuery,
} from './provider-observations'

const origin = 'https://accounts.example.test'
const fixture = {
  version: 'mpdee-provider-observation-v1', provider: 'vercel', accountRef: 'team_example',
  sourceKey: 'export:november', sourceHash: 'b'.repeat(64), observedAt: '2026-11-06T20:00:00Z',
  coverage: 'partial', status: 'requires_reconciliation',
  periods: [{ from: '2026-11-01', to: '2026-12-01' }], gaps: [],
  groups: [{ projectId: null, resourceId: null, currency: 'USD', usageValue: '12.34', subscriptionValue: '20' }],
}
function setup(role: 'anonymous' | 'readonly' | 'admin') {
  const rows = new Map<string, { id: string }>()
  const queries: ProviderObservationQuery[] = []
  let writes = 0
  const store: ProviderObservationStore = {
    findExact: async (_, checksum) => rows.get(checksum) ?? null,
    create: async (_, checksum) => {
      writes++
      const row = { id: `observation_${writes}` }
      rows.set(checksum, row)
      return row
    },
  }
  const deps: ProviderObservationDeps = {
    requireApiAuth: async () => { if (role === 'anonymous') throw new Error('Authentication required') },
    requireApiWrite: async () => {
      if (role === 'anonymous') throw new Error('Authentication required')
      if (role === 'readonly') throw new WriteAccessError()
    },
    isMachine: header => header === 'Bearer test-fixture-not-a-real-secret',
    list: async query => { queries.push(query); return providerObservationReport([], query.limit) },
    save: raw => createProviderObservation(raw, store),
  }
  return { deps, queries, writes: () => writes }
}
function request(method: 'GET' | 'POST', options: { token?: boolean; from?: string; query?: string; body?: unknown; raw?: string } = {}) {
  return new NextRequest(`${origin}/api/costs/provider-observations${options.query ?? ''}`, {
    method, headers: {
      ...(options.token ? { Authorization: 'Bearer test-fixture-not-a-real-secret' } : {}),
      ...(options.from ? { Origin: options.from } : {}),
    },
    ...(method === 'GET' ? {} : { body: options.raw ?? JSON.stringify(options.body ?? fixture) }),
  })
}
test('provider observations API: authenticated readers and ingest token can read; anonymous cannot', async () => {
  for (const [role, token, status] of [
    ['anonymous', false, 401], ['readonly', false, 200], ['admin', false, 200], ['anonymous', true, 200],
  ] as const) {
    const context = setup(role)
    const response = await handleProviderObservations(request('GET', { token }), 'GET', context.deps)
    assert.equal(response.status, status)
    assert.equal(context.writes(), 0)
    assert.equal(context.queries.length, status === 200 ? 1 : 0)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
    assert.equal(response.headers.get('Vary'), 'Authorization, Cookie')
  }
})
test('provider observations API: machine or same-origin writer can import; other sessions and origins rejected', async () => {
  for (const [role, token, from, status] of [
    ['anonymous', false, origin, 401], ['readonly', false, origin, 403],
    ['admin', false, undefined, 403], ['admin', false, 'https://evil.test', 403],
    ['admin', false, origin, 201], ['anonymous', true, undefined, 201],
  ] as const) {
    const context = setup(role)
    const response = await handleProviderObservations(request('POST', { token, from }), 'POST', context.deps)
    assert.equal(response.status, status)
    assert.equal(context.writes(), status === 201 ? 1 : 0)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  }
})
test('provider observations API: exact replay returns same ID, corrections append and replay never rewrites', async () => {
  const context = setup('anonymous')
  const post = (body: unknown) => handleProviderObservations(request('POST', { token: true, body }), 'POST', context.deps)
  const added = await post(fixture)
  assert.equal(added.status, 201)
  const first = await added.json()
  const duplicate = await post(fixture)
  assert.equal(duplicate.status, 200)
  assert.deepEqual(await duplicate.json(), { ...first, status: 'duplicate' })
  const correction = await post({ ...fixture, notes: 'Correction' })
  assert.equal(correction.status, 201)
  assert.notEqual((await correction.json()).id, first.id)
  assert.equal((await post(fixture)).status, 200)
  assert.equal(context.writes(), 2)
})
test('provider observations API: strict bounded reads and streamed body reject before writes', async () => {
  const context = setup('admin')
  for (const query of ['?limit=101', '?accountRef=a&accountRef=b', '?cashPaid=true', '?provider=aws', '?sourceKey=bad%2Fkey']) {
    assert.equal((await handleProviderObservations(request('GET', { query }), 'GET', context.deps)).status, 400)
  }
  assert.equal(context.queries.length, 0)
  for (const [raw, status] of [['{invalid', 400], [' '.repeat(MAX_OBSERVATION_BYTES + 1), 413]] as const) {
    const response = await handleProviderObservations(request('POST', { from: origin, raw }), 'POST', context.deps)
    assert.equal(response.status, status)
    assert.match(response.headers.get('Cache-Control') ?? '', /no-store/)
  }
  for (const body of [{ ...fixture, cashPaid: true }, { ...fixture, groups: Array(201).fill(fixture.groups[0]) }]) {
    assert.equal((await handleProviderObservations(request('POST', { from: origin, body }), 'POST', context.deps)).status, 400)
  }
  assert.equal(context.writes(), 0)
  const valid = await handleProviderObservations(request('GET', { query: '?limit=100&accountRef=team_example&sourceKey=export:november' }), 'GET', context.deps)
  assert.equal(valid.status, 200)
  assert.deepEqual(context.queries, [{ limit: 100, accountRef: 'team_example', sourceKey: 'export:november' }])
  assert.ok((await valid.json()).warnings.includes('snapshots_may_overlap_do_not_add'))
})
test('provider observations API: unknown Accounts project produces explicit validation failure', async () => {
  const context = setup('admin')
  context.deps.save = async () => { throw new ProviderObservationError(400, 'Choose existing Accounts cost projects') }
  const response = await handleProviderObservations(request('POST', { from: origin }), 'POST', context.deps)
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'Choose existing Accounts cost projects' })
})
test('provider observations API: middleware allows machine requests through to auth handlers but protects page', () => {
  for (const method of ['GET', 'POST'] as const) {
    const response = middleware(request(method, { token: true }))
    assert.equal(response.headers.get('x-middleware-next'), '1')
    assert.equal(response.headers.get('location'), null)
  }
  assert.equal(middleware(new NextRequest(`${origin}/costs/provider-observations`)).status, 307)
})
