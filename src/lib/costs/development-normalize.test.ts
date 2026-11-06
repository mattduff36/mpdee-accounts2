import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { importSchema, normalize, retainTaskContext } from './normalize'
import { decimalUnits } from './money'

const timestamp = '2026-11-01T00:00:00.000Z'
const development = {
  recordClass: 'task-measurement', workItemId: 'work-1', parentChatId: 'chat-1',
  taskId: 'task-1', attempt: 1, observedAt: '2026-11-02T00:00:00.000Z', coverage: 'complete',
}
const event = { timestamp, sourceId: 'task-1:attempt-1', nominalAmount: '1.2345678', development }
const payload = { provider: 'codex', accountRef: 'development-test', quality: 'complete', events: [event] }
const row = (patch: Record<string, unknown> = {}, provider = 'codex') =>
  normalize(importSchema.parse({ ...payload, provider, events: [{ ...event, ...patch }] }))[0]

test('OpenAI and Codex monetary usage is not cash or proof of funding, and complete evidence stays held', () => {
  for (const provider of ['openai', 'codex']) {
    const result = row({
      kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO', chargedCents: 0,
      tokenUsage: { inputTokens: 1000, outputTokens: 250, totalCents: 999 },
    }, provider)
    assert.equal(result.funding, 'unknown')
    assert.equal(result.cash, null)
    assert.equal(result.nominal, decimalUnits('1.2345678'))
    assert.equal(result.evidence.development?.funding, 'unknown')
    assert.equal(result.quality, 'review')
    assert.match(result.reason!, /client charging held/)
    assert.equal(row({ nominalAmount: null, tokenUsage: { totalCents: 999 } }, provider).nominal, null)
    assert.equal(row({ nominalAmount: null, billedAmount: '3' }, provider).nominal, null)
    for (const funding of ['unknown', 'paid', 'grant', 'subscription']) {
      const explicit = row({ billedAmount: '0', development: { ...development, funding } }, provider)
      assert.equal(explicit.funding, funding)
      assert.equal(explicit.cash, BigInt(0))
      assert.equal(explicit.quality, 'review')
    }
    assert.equal(row({ billedAmount: '2.30' }, provider).cash, decimalUnits('2.30'))
  }
})

test('stable source identity survives corrections, reorder, subsets and repeat imports', () => {
  const first = row()
  assert.equal(first.sourceKey, 'task-1:attempt-1:0')
  assert.equal(row().checksum, first.checksum)
  const corrected = row({ nominalAmount: '2', timestamp: '2026-11-01T01:00:00Z' })
  assert.equal(corrected.sourceKey, first.sourceKey)
  assert.notEqual(corrected.checksum, first.checksum)
  const second = { ...event, sourceId: 'task-2:attempt-1', development: { ...development, taskId: 'task-2' } }
  const batch = (events: unknown[]) => normalize(importSchema.parse({ ...payload, events }))
  assert.deepEqual(batch([second, event]).map(result => result.sourceKey), ['task-2:attempt-1:0', first.sourceKey])
  assert.equal(batch([event, second])[0].checksum, first.checksum)
  assert.throws(() => batch([event, event]), /Repeated development sourceId/)
  for (const patch of [{ sourceId: undefined }, { sourceId: ' ' }, { sourceId: 'a'.repeat(251) }, { sourceId: 'line\nprompt' }, { development: undefined }]) {
    assert.equal(importSchema.safeParse({ ...payload, events: [{ ...event, ...patch }] }).success, false)
  }
})

test('every metadata field is revision evidence, not usage identity, and object order is deterministic', () => {
  const first = row()
  for (const patch of [
    { recordClass: 'provider-daily-aggregate' }, { workItemId: 'work-2' }, { parentChatId: 'chat-2' },
    { taskId: 'task-2' }, { attempt: 2 }, { observedAt: '2026-11-03T00:00:00Z' },
    { coverage: 'partial' }, { funding: 'paid' },
  ]) {
    const changed = row({ development: { ...development, ...patch } })
    assert.equal(changed.sourceKey, first.sourceKey)
    assert.notEqual(changed.checksum, first.checksum)
    assert.equal(changed.quality, 'review')
  }
  const reordered = Object.fromEntries(Object.entries(development).reverse())
  assert.equal(row({ development: reordered }).checksum, first.checksum)
  assert.equal(row({ development: { ...development, observedAt: '2026-11-02T01:00:00+01:00', funding: 'unknown' } }).checksum, first.checksum)
})

test('daily provider aggregates retain their explicit class separately from task measurements', () => {
  const daily = row({
    sourceId: 'openai:daily:2026-11-01',
    development: { ...development, recordClass: 'provider-daily-aggregate', workItemId: null, parentChatId: null, taskId: null, attempt: null },
  }, 'openai')
  assert.equal(daily.evidence.development?.recordClass, 'provider-daily-aggregate')
  assert.equal(daily.evidence.development?.taskId, null)
  assert.equal(daily.funding, 'unknown')
  assert.equal(daily.cash, null)
  assert.equal(daily.quality, 'review')
  assert.equal(row().evidence.development?.recordClass, 'task-measurement')
})

test('development metadata is bounded and strict, never a container for raw content', () => {
  for (const patch of [
    { prompt: 'private' }, { code: 'private' }, { credentials: 'private' }, { notes: 'private' },
    { recordClass: 'estimate' }, { funding: 'free-credit' }, { coverage: 'assumed' },
    { taskId: 'contains spaces or raw content' }, { workItemId: 'a'.repeat(161) },
    { parentChatId: null }, { attempt: null }, { attempt: 0 }, { attempt: 1.5 }, { attempt: 1_000_001 },
    { observedAt: 'not-a-date' }, { observedAt: '2026-02-30T00:00:00Z' }, { observedAt: '2026-11-02T00:00:00+99:99' },
  ]) {
    assert.equal(importSchema.safeParse({ ...payload, events: [{ ...event, development: { ...development, ...patch } }] }).success, false, JSON.stringify(patch))
  }
  const sanitized = row({ prompt: 'private', code: 'private', credentials: 'private' })
  assert.ok(!JSON.stringify(sanitized.evidence).includes('private'))
})

test('legacy replay retains only validated development metadata; explicit corrections win', () => {
  const legacyPayload = { ...payload, provider: 'manual', events: [{ timestamp, sourceId: 'legacy-1', billedAmount: '1' }] }
  const legacy = () => normalize(importSchema.parse(legacyPayload))[0]
  const enriched = normalize(importSchema.parse({ ...legacyPayload, events: [{ ...legacyPayload.events[0], development }] }))[0]
  const replay = legacy()
  retainTaskContext(replay, enriched.evidence)
  assert.deepEqual(replay.evidence.development, enriched.evidence.development)
  assert.equal(replay.checksum, enriched.checksum)
  const correction = row({ development: { ...development, coverage: 'partial' } })
  const correctedChecksum = correction.checksum
  retainTaskContext(correction, row().evidence)
  assert.equal(correction.checksum, correctedChecksum)
  for (const prior of [null, [], { development: { ...development, prompt: 'private' } }, { development: { ...development, taskId: null } }]) {
    const unchanged = legacy()
    const checksum = unchanged.checksum
    retainTaskContext(unchanged, prior)
    assert.equal(unchanged.checksum, checksum)
    assert.equal(unchanged.evidence.development, undefined)
  }
})

test('legacy Cursor and infrastructure checksums do not gain absent metadata fields', () => {
  const checksum = (value: object) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const [cursor] = normalize(importSchema.parse({ accountRef: 'legacy-test', quality: 'complete', events: [{
    timestamp, model: 'legacy-model', kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO', tokenUsage: { totalCents: 100 },
  }] }))
  assert.equal(cursor.checksum, checksum({
    funding: 'included', nominal: '10000000', cash: '0', currency: 'USD', occurredAt: timestamp,
    model: 'legacy-model', reason: null, tokens: [null, null, null, null],
  }))
  assert.equal(cursor.quality, 'complete')
  for (const provider of ['vercel', 'supabase', 'manual']) {
    const [infra] = normalize(importSchema.parse({ provider, accountRef: 'legacy-test', quality: 'complete', events: [{
      timestamp, sourceId: 'invoice-1', billedAmount: '-1.25', currency: 'GBP',
    }] }))
    assert.equal(infra.sourceKey, 'invoice-1:0')
    assert.equal(infra.checksum, checksum({
      funding: 'infrastructure', nominal: '-12500000', cash: '-12500000', currency: 'GBP', occurredAt: timestamp, reason: null,
    }))
    assert.equal(infra.quality, 'complete')
  }
})
