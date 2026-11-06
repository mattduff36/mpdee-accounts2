import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import {
  createProviderObservation, normalizeProviderObservation, providerObservationSchema,
  providerObservationQuerySchema, providerObservationReport, latestProviderObservations,
  type ObservationRow, type ProviderObservationStore,
} from './provider-observations'
import { listProviderObservations, providerObservationAdapter } from './provider-observations-store'

const fixture = {
  version: 'mpdee-provider-observation-v1', provider: 'vercel', accountRef: 'team_example',
  sourceKey: 'export:2026-11', sourceHash: 'a'.repeat(64), observedAt: '2026-11-06T20:00:00Z',
  coverage: 'partial', status: 'requires_reconciliation',
  periods: [{ from: '2026-11-01', to: '2026-12-01' }],
  gaps: [{ from: '2026-11-07', to: '2026-12-01' }],
  groups: [{ projectId: 'accounts_project', resourceId: 'prj_example', currency: 'USD', usageValue: '12.3456', subscriptionValue: '20.00' }],
  notes: 'Partial export',
}
function memoryStore() {
  const rows: { id: string; key: string }[] = []
  const key = (raw: typeof fixture | { provider: string; accountRef: string; sourceKey: string }, checksum: string) =>
    JSON.stringify([raw.provider, raw.accountRef, raw.sourceKey, checksum])
  const store: ProviderObservationStore = {
    findExact: async (record, checksum) => rows.find(row => row.key === key(record, checksum)) ?? null,
    create: async (record, checksum) => {
      const row = { id: `observation_${rows.length + 1}`, key: key(record, checksum) }
      rows.push(row)
      return row
    },
  }
  return { rows, store }
}
function observation(id: string, raw: unknown = fixture, createdAt = '2026-11-06T20:01:00Z'): ObservationRow {
  const { record, checksum } = normalizeProviderObservation(raw)
  return { id, ...record, checksum, payload: record, observedAt: new Date(record.observedAt), createdAt: new Date(createdAt) }
}
test('provider observations: canonical checksum, exact replay, changed corrections and old replay retained without promotion', async () => {
  const { rows, store } = memoryStore()
  assert.equal(normalizeProviderObservation(fixture).checksum,
    normalizeProviderObservation(Object.fromEntries(Object.entries(fixture).reverse())).checksum)
  assert.equal(normalizeProviderObservation({ ...fixture, sourceHash: 'A'.repeat(64) }).checksum, normalizeProviderObservation(fixture).checksum)
  const added = await createProviderObservation(fixture, store)
  assert.equal(added.status, 'added')
  assert.match(added.checksum, /^[a-f0-9]{64}$/)
  assert.deepEqual(await createProviderObservation(fixture, store), { ...added, status: 'duplicate' })
  const corrected = await createProviderObservation({ ...fixture, notes: 'Corrected export' }, store)
  assert.equal(corrected.status, 'added')
  assert.notEqual(corrected.id, added.id)
  assert.notEqual(corrected.checksum, added.checksum)
  assert.deepEqual(await createProviderObservation(fixture, store), { ...added, status: 'duplicate' })
  assert.equal(rows.length, 2)
  await createProviderObservation({ ...fixture, accountRef: 'other_account' }, store)
  await createProviderObservation({ ...fixture, sourceKey: 'other_export' }, store)
  assert.equal(rows.length, 4)
})
test('provider observations: strict schema rejects invalid dates, fields, hashes, identifiers and bounds', () => {
  for (const change of [
    { version: 'v2' }, { provider: 'aws' }, { accountRef: '' }, { accountRef: '../private' },
    { sourceKey: 'bad/key' }, { sourceKey: 'a'.repeat(161) }, { sourceHash: 'g'.repeat(64) },
    { sourceHash: 'a'.repeat(63) }, { observedAt: '2026-02-30T00:00:00Z' },
    { observedAt: '2026-11-06' }, { observedAt: '2026-11-06T00:00:00' },
    { periods: [] }, { periods: Array(32).fill(fixture.periods[0]) },
    { gaps: Array(32).fill(fixture.gaps[0]) }, { groups: Array(201).fill(fixture.groups[0]) },
    { coverage: 'unknown' }, { status: 'paid' }, { notes: 'x'.repeat(501) }, { notes: 'bad\u0000note' },
    { cashPaid: true }, { expenseId: 'expense' }, { taxMinor: 0 }, { checksum: 'caller-controlled' },
  ]) assert.equal(providerObservationSchema.safeParse({ ...fixture, ...change }).success, false, JSON.stringify(change))
  for (const from of ['2026-02-29', '2026-02-30', '2026-2-01', '1899-12-31', 'invalid', '2026-02-30T10:00:00Z']) {
    assert.equal(providerObservationSchema.safeParse({ ...fixture, periods: [{ from, to: '2026-12-01' }] }).success, false, from)
  }
  for (const period of [
    { from: '2026-11-01', to: '2026-11-01' },
    { from: '2026-11-02', to: '2026-11-01' },
    { from: '2026-11-01', to: '2026-12-01', extra: 1 },
  ]) assert.equal(providerObservationSchema.safeParse({ ...fixture, gaps: [period] }).success, false)
  assert.equal(providerObservationSchema.safeParse({
    ...fixture, periods: [{ from: '2028-02-29T00:00:00+01:00', to: '2028-03-01T00:00:00+01:00' }],
    groups: Array(200).fill(fixture.groups[0]), gaps: Array(31).fill(fixture.gaps[0]), notes: 'x'.repeat(500),
  }).success, true)
})
test('provider observations: decimal strings preserve precision and never accept non-finite, signed or excess amounts', () => {
  for (const value of ['0', '0.000000000000000001', '12.345678901234567890', '999999999.999999999999999999', '1000000000', '1000000000.000000000000000000']) {
    const parsed = providerObservationSchema.parse({ ...fixture, groups: [{ ...fixture.groups[0], usageValue: value, subscriptionValue: value }] })
    assert.equal(parsed.groups[0].usageValue, value)
  }
  for (const value of [-1, 1, NaN, Infinity, '-1', '+1', 'NaN', 'Infinity', '1e3', '.1', '1.', '01', ' 1', '1000000000.000000000000000001', '1000000001', '0.1234567890123456789', '9'.repeat(100)]) {
    for (const field of ['usageValue', 'subscriptionValue']) {
      assert.equal(providerObservationSchema.safeParse({ ...fixture, groups: [{ ...fixture.groups[0], [field]: value }] }).success, false, `${field}: ${value}`)
    }
  }
  for (const group of [
    { ...fixture.groups[0], currency: 'JPY' }, { ...fixture.groups[0], currency: 'usd' },
    { ...fixture.groups[0], projectId: 'unsafe/id' }, { ...fixture.groups[0], resourceId: '' },
    { ...fixture.groups[0], expenseId: 'expense' }, { ...fixture.groups[0], paid: true },
  ]) assert.equal(providerObservationSchema.safeParse({ ...fixture, groups: [group] }).success, false)
  const parsed = providerObservationSchema.parse({ ...fixture, groups: [{ currency: 'GBP', usageValue: '0', subscriptionValue: '0' }] })
  assert.equal(parsed.groups[0].projectId, null)
  assert.equal(parsed.groups[0].resourceId, null)
})
test('provider observations: latest source correction selected, overlapping snapshots never combined', () => {
  const original = observation('original')
  const corrected = observation('corrected', { ...fixture, notes: 'Corrected', groups: [{ ...fixture.groups[0], usageValue: '15' }] }, '2026-11-06T20:02:00Z')
  const staleLateArrival = observation('stale', { ...fixture, observedAt: '2026-11-05T20:00:00Z' }, '2026-11-07T20:00:00Z')
  const overlapping = observation('overlap', { ...fixture, sourceKey: 'overlapping_export' })
  const otherAccount = observation('other', { ...fixture, accountRef: 'other_team' })
  const report = providerObservationReport([original, corrected, staleLateArrival, overlapping, otherAccount], 50)
  assert.deepEqual(report.records.map(row => row.id), ['corrected', 'overlap', 'other'])
  assert.deepEqual(report.records.map(row => row.groups[0].usageValue), ['15', '12.3456', '12.3456'])
  assert.deepEqual(report.records[0].warnings, ['partial_coverage', 'declared_gaps', 'requires_reconciliation'])
  assert.ok(report.warnings.includes('snapshots_may_overlap_do_not_add'))
  assert.ok(report.warnings.includes('provisional_provider_values_not_cash_paid_or_expenses'))
  for (const key of ['total', 'grandTotal', 'cashPaid', 'expense', 'gbpEstimatePence']) assert.equal(key in report, false)
  const capped = providerObservationReport([original, corrected, overlapping, otherAccount], 1)
  assert.equal(capped.records.length, 1)
  assert.equal(capped.records[0].id, 'corrected')
  assert.equal(capped.truncated, true)
  assert.ok(capped.warnings.includes('result_truncated_refine_accountRef_or_sourceKey'))
  const tie = { ...corrected, id: 'zzz' }
  assert.equal(latestProviderObservations([corrected, tie])[0].id, 'zzz')
  const complete = observation('complete', { ...fixture, coverage: 'complete', status: 'provider_reported', gaps: [], groups: [] })
  assert.deepEqual(providerObservationReport([complete], 50).records[0].warnings, [])
})
test('provider observations: bounded strict queries', () => {
  assert.deepEqual(providerObservationQuerySchema.parse({}), { limit: 50 })
  assert.equal(providerObservationQuerySchema.parse({ limit: '100', provider: 'vercel' }).limit, 100)
  for (const query of [{ limit: '101' }, { limit: '0' }, { limit: '001' }, { limit: 10 }, { limit: '1e2' }, { provider: 'aws' }, { projectId: 'project' }, { sourceKey: 'unsafe/path' }]) {
    assert.equal(providerObservationQuerySchema.safeParse(query).success, false)
  }
})
test('provider observations: adapter validates project IDs and writes only immutable observation JSON', async t => {
  const { record, checksum } = normalizeProviderObservation(fixture)
  const database = {
    costProject: { ...prisma.costProject },
    costProviderObservation: { ...prisma.costProviderObservation },
  }
  const count = t.mock.method(database.costProject, 'count', async () => 0)
  const create = t.mock.method(database.costProviderObservation, 'create', async () => ({ id: 'new' }))
  const adapter = providerObservationAdapter(database)
  await assert.rejects(adapter.create(record, checksum), { status: 400 })
  assert.equal(create.mock.callCount(), 0)
  count.mock.mockImplementation(async () => 1)
  await adapter.create({ ...record, groups: [record.groups[0], record.groups[0]] }, checksum)
  assert.deepEqual(count.mock.calls[1].arguments[0], { where: { id: { in: ['accounts_project'] } } })
  const args = create.mock.calls[0].arguments[0]
  assert.ok(args && 'data' in args)
  assert.equal(args.data.checksum, checksum)
  assert.equal(args.data.provider, 'vercel')
  assert.deepEqual(args.data.payload, { ...record, groups: [record.groups[0], record.groups[0]] })
  assert.deepEqual(Object.keys(args.data).sort(), ['accountRef', 'checksum', 'observedAt', 'payload', 'provider', 'sourceKey'])
  const find = t.mock.method(database.costProviderObservation, 'findUnique', async () => ({ id: 'existing' }))
  assert.deepEqual(await adapter.findExact(record, checksum), { id: 'existing' })
  assert.deepEqual(find.mock.calls[0].arguments[0], { where: {
    provider_accountRef_sourceKey_checksum: { provider: 'vercel', accountRef: record.accountRef, sourceKey: record.sourceKey, checksum },
  }, select: { id: true } })
  await adapter.create({ ...record, groups: [{ ...record.groups[0], projectId: null }] }, checksum)
  assert.equal(count.mock.callCount(), 2)
})
test('provider observations: PostgreSQL selects latest before bounded read using parameterized filters', async t => {
  const read = t.mock.method(prisma, '$queryRaw', async () => [observation('one')])
  const report = await listProviderObservations({ limit: 1, accountRef: 'team_example', sourceKey: 'export:2026-11' })
  assert.equal(report.records.length, 1)
  const sql = read.mock.calls[0].arguments[0]
  assert.ok(sql && typeof sql === 'object' && 'text' in sql && 'values' in sql)
  assert.match(String(sql.text), /SELECT DISTINCT ON/)
  assert.match(String(sql.text), /"observedAt" DESC, "createdAt" DESC, "id" DESC\s+LIMIT/)
  assert.deepEqual(sql.values, ['team_example', 'export:2026-11', 2])
})
test('provider observations: migration and report remain isolated from legacy financial surfaces', () => {
  const source = (path: string) => readFileSync(join(process.cwd(), ...path.split('/')), 'utf8')
  const store = source('src/lib/costs/provider-observations-store.ts')
  assert.match(store, /pg_advisory_xact_lock\(739201684\)/)
  assert.doesNotMatch(store, /costChargeSnapshot|expense\.|invoice\.|costUsageEvent|costPolicy|\.update|\.delete/)
  const migration = source('prisma/migrations/20261106210000_provider_observations/migration.sql')
  assert.doesNotMatch(migration, /DROP |ALTER |UPDATE |DELETE |INSERT /)
  assert.match(migration, /UNIQUE INDEX[\s\S]*"provider", "accountRef", "sourceKey", "checksum"/)
  const page = source('src/app/costs/provider-observations/page.tsx')
  assert.match(page, /await requireAuth\(\)/)
  assert.match(page, /dynamic = 'force-dynamic'/)
  assert.doesNotMatch(page, /saveProviderObservation|createProviderObservation|method="post"|reduce\(/)
  assert.match(page, /Usage value/)
  assert.match(page, /Subscription value/)
  assert.match(source('src/app/costs/CostsNav.tsx'), /openToReaders=new Set\([^\n]*'\/costs\/provider-observations'/)
})
