import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { WriteAccessError } from '@/lib/auth'
import { middleware } from '../../../middleware'
import { handleManualAllocations, type ManualAllocationDeps } from '@/app/api/costs/manual-allocations/handler'
import {
  MANUAL_ALLOCATION_VERSION, ManualAllocationError, manualAllocationSchema, manualAllocationState,
  type ManualAllocationQuery,
} from './manual-allocation'

const origin = 'https://accounts.example.test'
const fixture = {
  version: MANUAL_ALLOCATION_VERSION, sourceKind: 'subscription_invoice', sourceId: 'invoice_one',
  expectedRevision: 0, shares: [{ projectId: 'project_one', shareBps: 10000 }],
}
function setup(role: 'anonymous' | 'readonly' | 'admin') {
  const writes: { actorId: string; raw: unknown }[] = []
  const reads: ManualAllocationQuery[] = []
  const deps: ManualAllocationDeps = {
    requireApiAuth: async () => { if (role === 'anonymous') throw new Error('Authentication required'); return { id: 'owner', role } },
    requireApiWrite: async () => {
      if (role === 'anonymous') throw new Error('Authentication required')
      if (role === 'readonly') throw new WriteAccessError()
      return { id: 'owner' }
    },
    isReadToken: value => value === 'Bearer test-read-token',
    list: async query => {
      reads.push(query)
      return {
        version: 'mpdee-manual-allocation-report-v1', sourceKind: query.sourceKind, asOf: query.asOf,
        scope: 'invoice_only', additiveToExistingCosts: false, allocationEvidence: 'user_selected_not_measured_usage',
        records: [], pageTotals: [], nextCursor: null,
      }
    },
    save: async (raw, actorId) => {
      const input = manualAllocationSchema.parse(raw)
      writes.push({ raw, actorId })
      return manualAllocationState({ revision: input.expectedRevision + 1, shares: input.shares })
    },
  }
  return { deps, writes, reads }
}
function request(method: 'GET' | 'POST', options: { token?: boolean; from?: string; body?: unknown; raw?: string; query?: string } = {}) {
  return new NextRequest(`${origin}/api/costs/manual-allocations${options.query ?? '?sourceKind=subscription_invoice'}`, {
    method, headers: {
      ...(options.token ? { Authorization: 'Bearer test-read-token' } : {}),
      ...(options.from ? { Origin: options.from } : {}),
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body: options.raw ?? JSON.stringify(options.body ?? fixture) } : {}),
  })
}
test('allocation report is read-only for reader sessions and tokens, anonymous sessions are denied', async () => {
  for (const [role, token, status] of [
    ['anonymous', false, 401], ['anonymous', true, 200], ['readonly', false, 200], ['admin', false, 200],
  ] as const) {
    const context = setup(role)
    const response = await handleManualAllocations(request('GET', { token }), 'GET', context.deps)
    assert.equal(response.status, status)
    assert.equal(context.writes.length, 0)
    assert.equal(context.reads.length, status === 200 ? 1 : 0)
    assert.match(response.headers.get('Cache-Control') ?? '', /private, no-store/)
    assert.equal(response.headers.get('Vary'), 'Authorization, Cookie')
  }
})
test('only a signed-in writer with exact same origin can save; bearer tokens confer no write authority', async () => {
  for (const [role, token, from, status] of [
    ['anonymous', false, origin, 401], ['anonymous', true, origin, 401],
    ['readonly', false, origin, 403], ['readonly', true, origin, 403],
    ['admin', false, undefined, 403], ['admin', false, 'null', 403],
    ['admin', true, 'https://other.example.test', 403], ['admin', false, `${origin}.evil.test`, 403],
    ['admin', false, origin, 200],
  ] as const) {
    const context = setup(role)
    const response = await handleManualAllocations(request('POST', { token, from }), 'POST', context.deps)
    assert.equal(response.status, status)
    assert.equal(context.writes.length, status === 200 ? 1 : 0)
    if (status === 200) assert.equal(context.writes[0].actorId, 'owner')
  }
})
test('malformed input, streamed size limits and unknown or duplicate query fields fail explicitly', async () => {
  const context = setup('admin')
  for (const query of [
    '', '?sourceKind=usage', '?sourceKind=subscription_invoice&sourceKind=custom_recurring',
    '?sourceKind=subscription_invoice&limit=101', '?sourceKind=subscription_invoice&unknown=one',
  ]) assert.equal((await handleManualAllocations(request('GET', { query }), 'GET', context.deps)).status, 400)
  for (const body of [{ ...fixture, expectedRevision: undefined }, { ...fixture, shares: [{ projectId: 'one', shareBps: 10001 }] }]) {
    assert.equal((await handleManualAllocations(request('POST', { from: origin, body }), 'POST', context.deps)).status, 400)
  }
  assert.equal((await handleManualAllocations(request('POST', { from: origin, raw: '{bad' }), 'POST', context.deps)).status, 400)
  assert.equal((await handleManualAllocations(request('POST', { from: origin, raw: ' '.repeat(16385) }), 'POST', context.deps)).status, 413)
  assert.equal(context.writes.length, 0)
  assert.equal(context.reads.length, 0)
})
test('conflicts, unknown sources and nonexistent projects keep distinct response statuses', async () => {
  const context = setup('admin')
  for (const status of [400, 404, 409] as const) {
    context.deps.save = async () => { throw new ManualAllocationError(status, 'Nothing changed') }
    const response = await handleManualAllocations(request('POST', { from: origin }), 'POST', context.deps)
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error: 'Nothing changed' })
  }
})
test('middleware lets the handler authenticate token reads and saves without granting access itself', () => {
  for (const method of ['GET', 'POST'] as const) {
    const response = middleware(request(method, { token: true }))
    assert.equal(response.headers.get('x-middleware-next'), '1')
    assert.equal(response.headers.get('location'), null)
  }
  assert.equal(middleware(new NextRequest(`${origin}/costs/manual-allocations`)).status, 307)
})
