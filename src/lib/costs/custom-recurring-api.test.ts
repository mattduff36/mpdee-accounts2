import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { WriteAccessError } from '@/lib/auth'
import { middleware } from '../../../middleware'
import { handleCustomRecurring, type CustomRecurringDeps } from '@/app/api/costs/custom-recurring/handler'
import {
  customRecurringCreateSchema, customRecurringEditSchema, CustomRecurringError,
  type CustomRecurringActor, type CustomRecurringQuery,
} from './custom-recurring'

const origin = 'https://accounts.example.test'
const fixture = {
  version: 'mpdee-custom-recurring-v1', sourceKey: 'worker-live:itrader:imagekit',
  projectId: 'project_itrader', provider: 'ImageKit', name: 'Media', currency: 'USD',
  amountMinor: 900, recurrence: 'monthly', effectiveStart: '2026-11-01',
  effectiveEnd: null, active: true, notes: null,
}
function setup(role: 'anonymous' | 'readonly' | 'admin') {
  const calls: { actor: CustomRecurringActor; mode: string }[] = []
  const queries: CustomRecurringQuery[] = []
  const deps: CustomRecurringDeps = {
    requireApiAuth: async () => { if (role === 'anonymous') throw new Error('Authentication required'); return { id: 'user', role } },
    requireApiWrite: async () => {
      if (role === 'anonymous') throw new Error('Authentication required')
      if (role === 'readonly') throw new WriteAccessError()
      return { id: 'user' }
    },
    isMachine: header => header === 'Bearer test-machine',
    list: async query => { queries.push(query); return { version: 'mpdee-custom-recurring-list-v1', records: [], nextCursor: null } },
    save: async (raw, actor, mode) => {
      if (mode === 'create') customRecurringCreateSchema.parse(raw)
      else customRecurringEditSchema.parse(raw)
      calls.push({ actor, mode })
      return { version: 'mpdee-custom-recurring-ack-v1', status: mode === 'create' ? 'added' : 'updated', id: 'one', revision: mode === 'create' ? 1 : 2 }
    },
  }
  return { deps, calls, queries }
}
function request(method: 'GET' | 'POST' | 'PATCH', options: { token?: boolean; from?: string; body?: unknown; query?: string; raw?: string } = {}) {
  return new NextRequest(`${origin}/api/costs/custom-recurring${options.query ?? ''}`, {
    method, headers: {
      ...(options.token ? { Authorization: 'Bearer test-machine' } : {}),
      ...(options.from ? { Origin: options.from } : {}),
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(method === 'GET' ? {} : { body: options.raw ?? JSON.stringify(options.body ?? fixture) }),
  })
}
test('custom recurring API: unauthenticated GET denied, readers and machine reads allowed with no writes', async () => {
  for (const [role, token, status] of [
    ['anonymous', false, 401], ['readonly', false, 200], ['admin', false, 200], ['anonymous', true, 200],
  ] as const) {
    const context = setup(role)
    const response = await handleCustomRecurring(request('GET', { token }), 'GET', context.deps)
    assert.equal(response.status, status)
    assert.equal(context.calls.length, 0)
    assert.equal(context.queries.length, status === 200 ? 1 : 0)
    assert.match(response.headers.get('Cache-Control') ?? '', /no-store/)
  }
})
test('custom recurring API: create accepts machine or same-origin writer only', async () => {
  for (const [role, token, from, status] of [
    ['anonymous', false, origin, 401], ['readonly', false, origin, 403],
    ['admin', false, undefined, 403], ['admin', false, 'https://evil.test', 403],
    ['admin', false, origin, 201], ['anonymous', true, undefined, 201],
  ] as const) {
    const context = setup(role)
    const response = await handleCustomRecurring(request('POST', { token, from }), 'POST', context.deps)
    assert.equal(response.status, status)
    assert.equal(context.calls.length, status === 201 ? 1 : 0)
    if (status === 201) assert.deepEqual(context.calls[0].actor, token ? { actorType: 'machine', actorId: null } : { actorType: 'user', actorId: 'user' })
  }
})
test('custom recurring API: PATCH never permits token-only or read-only writes; same-origin writer edits require revision', async () => {
  const { sourceKey: _, ...fields } = fixture
  const body = { ...fields, id: 'one', expectedRevision: 1, active: false }
  for (const [role, token, from, status] of [
    ['anonymous', true, origin, 401], ['readonly', true, origin, 403],
    ['admin', false, undefined, 403], ['admin', false, 'https://evil.test', 403], ['admin', false, origin, 200],
  ] as const) {
    const context = setup(role)
    const response = await handleCustomRecurring(request('PATCH', { token, from, body }), 'PATCH', context.deps)
    assert.equal(response.status, status)
    assert.equal(context.calls.length, status === 200 ? 1 : 0)
    if (status === 200) assert.deepEqual(context.calls[0], { actor: { actorType: 'user', actorId: 'user' }, mode: 'edit' })
  }
  const context = setup('admin')
  assert.equal((await handleCustomRecurring(request('PATCH', { from: origin, body: fields }), 'PATCH', context.deps)).status, 400)
  assert.equal(context.calls.length, 0)
})
test('custom recurring API: strict bounded query, malformed JSON and streamed body limits', async () => {
  const context = setup('admin')
  for (const query of ['?limit=101', '?projectId=one&projectId=two', '?unknown=secret', '?after=unsafe%2Fpath']) {
    assert.equal((await handleCustomRecurring(request('GET', { query }), 'GET', context.deps)).status, 400)
  }
  assert.equal(context.queries.length, 0)
  assert.equal((await handleCustomRecurring(request('POST', { from: origin, raw: '{invalid' }), 'POST', context.deps)).status, 400)
  assert.equal((await handleCustomRecurring(request('POST', { from: origin, raw: ' '.repeat(16385) }), 'POST', context.deps)).status, 413)
  assert.equal(context.calls.length, 0)
  assert.equal((await handleCustomRecurring(request('GET', { query: '?limit=100&projectId=project_itrader&after=one' }), 'GET', context.deps)).status, 200)
  assert.deepEqual(context.queries, [{ limit: 100, projectId: 'project_itrader', after: 'one' }])
})
test('custom recurring API: conflicts are 409, duplicate acknowledges current revision and missing edit is 404', async () => {
  const context = setup('admin')
  context.deps.save = async () => { throw new CustomRecurringError(409, 'Recurring cost changed; reload before editing') }
  const conflict = await handleCustomRecurring(request('POST', { from: origin }), 'POST', context.deps)
  assert.equal(conflict.status, 409)
  context.deps.save = async () => ({ version: 'mpdee-custom-recurring-ack-v1', status: 'duplicate', id: 'one', revision: 3 })
  const duplicate = await handleCustomRecurring(request('POST', { token: true }), 'POST', context.deps)
  assert.equal(duplicate.status, 200)
  assert.equal((await duplicate.json()).revision, 3)
  context.deps.save = async () => { throw new CustomRecurringError(404, 'Recurring cost not found') }
  assert.equal((await handleCustomRecurring(request('PATCH', { from: origin }), 'PATCH', context.deps)).status, 404)
})
test('custom recurring API: middleware passes token-only requests to authenticated handlers, not login redirects', () => {
  for (const method of ['GET', 'POST', 'PATCH'] as const) {
    const response = middleware(request(method, { token: true }))
    assert.equal(response.headers.get('x-middleware-next'), '1')
    assert.equal(response.headers.get('location'), null)
  }
  const protectedPage = middleware(new NextRequest(`${origin}/costs/custom-recurring`))
  assert.equal(protectedPage.status, 307)
})
