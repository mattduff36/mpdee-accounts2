import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createCustomRecurring, editCustomRecurring, normalizeCustomRecurring, recurringFields,
  customRecurringCreateSchema, customRecurringEditSchema, customRecurringQuerySchema, CustomRecurringError,
  type CustomRecurringFields, type CustomRecurringIdentity, type CustomRecurringStore,
} from './custom-recurring'
import { customRecurringDto } from './custom-recurring-store'

const fixture = {
  version: 'mpdee-custom-recurring-v1', sourceKey: 'worker-live:itrader:imagekit',
  projectId: 'project_itrader', provider: 'ImageKit', name: 'Development media',
  currency: 'USD', amountMinor: 900, recurrence: 'monthly',
  effectiveStart: '2026-11-01', effectiveEnd: null, active: true, notes: null,
}
function memoryStore() {
  let row: (CustomRecurringIdentity & CustomRecurringFields) | null = null
  let writes = 0
  const store: CustomRecurringStore = {
    findSource: async () => row,
    findId: async id => row?.id === id ? row : null,
    create: async (record, importChecksum) => {
      writes++
      return row = { ...recurringFields(record), id: 'recurring_one', importChecksum, revision: 1 }
    },
    update: async record => {
      if (!row || row.revision !== record.expectedRevision) throw new CustomRecurringError(409, 'Conflict')
      writes++
      return row = { ...row, ...recurringFields(record), revision: row.revision + 1 }
    },
  }
  return { store, row: () => row, writes: () => writes }
}
test('custom recurring: canonical input has stable checksum, explicit zero and monthly rate only', () => {
  const normalized = normalizeCustomRecurring(fixture)
  assert.equal(normalized.record.amountMinor, 900)
  assert.equal(normalized.record.recurrence, 'monthly')
  assert.equal(normalized.checksum, normalizeCustomRecurring(Object.fromEntries(Object.entries(fixture).reverse())).checksum)
  assert.equal(normalizeCustomRecurring({ ...fixture, amountMinor: 0 }).record.amountMinor, 0)
  assert.equal(normalizeCustomRecurring({ ...fixture, provider: ' ImageKit ' }).checksum, normalized.checksum)
})
test('custom recurring: bounds, strict types, dates, currencies and unknown payment/tax fields are rejected', () => {
  for (const change of [
    { amountMinor: -1 }, { amountMinor: 1.5 }, { amountMinor: '900' }, { amountMinor: 2_000_000_001 },
    { sourceKey: 'unsafe/key' }, { sourceKey: 'a'.repeat(161) }, { projectId: '' },
    { provider: ' ' }, { name: 'x'.repeat(121) }, { provider: 'Image\nKit' },
    { currency: 'JPY' }, { currency: 'usd' }, { recurrence: 'annual' }, { active: 'true' },
    { effectiveStart: '2026-02-30' }, { effectiveStart: '2026-2-01' }, { effectiveStart: '1899-12-31' },
    { effectiveEnd: '2026-11-01' }, { effectiveEnd: '2026-10-31' }, { effectiveEnd: '2026-02-29' },
    { notes: 'x'.repeat(2001) }, { notes: 'bad\u0000note' }, { paymentStatus: 'paid' }, { taxMinor: 0 },
    { gbpEstimatePence: 900 }, { invoiceId: 'invoice' }, { expectedRevision: 1 },
  ]) assert.equal(customRecurringCreateSchema.safeParse({ ...fixture, ...change }).success, false, JSON.stringify(change))
  assert.equal(customRecurringCreateSchema.safeParse({ ...fixture, effectiveStart: '2028-02-29', effectiveEnd: '2028-03-01', notes: 'Two\nlines' }).success, true)
  for (const field of Object.keys(fixture)) {
    const value = { ...fixture } as Record<string, unknown>
    delete value[field]
    assert.equal(customRecurringCreateSchema.safeParse(value).success, false, `missing ${field}`)
  }
})
test('custom recurring: source replay remains duplicate after Accounts edits; changed imports never overwrite', async () => {
  const db = memoryStore()
  assert.deepEqual(await createCustomRecurring(fixture, db.store), {
    version: 'mpdee-custom-recurring-ack-v1', status: 'added', id: 'recurring_one', revision: 1,
  })
  assert.equal((await createCustomRecurring(fixture, db.store)).status, 'duplicate')
  const fields = recurringFields(normalizeCustomRecurring(fixture).record)
  const edited = { version: fixture.version, id: 'recurring_one', expectedRevision: 1, ...fields, amountMinor: 1200, active: false, notes: 'Reviewed locally' }
  assert.equal((await editCustomRecurring(edited, db.store)).revision, 2)
  assert.deepEqual(await createCustomRecurring(fixture, db.store), {
    version: 'mpdee-custom-recurring-ack-v1', status: 'duplicate', id: 'recurring_one', revision: 2,
  })
  await assert.rejects(createCustomRecurring({ ...fixture, amountMinor: 1200 }, db.store), { status: 409 })
  await assert.rejects(createCustomRecurring({ ...fixture, name: 'Renamed upstream' }, db.store), { status: 409 })
  await assert.rejects(editCustomRecurring({ ...edited, amountMinor: 1500 }, db.store), { status: 409 })
  assert.equal(db.writes(), 2)
  assert.equal(db.row()?.amountMinor, 1200)
  assert.equal(db.row()?.active, false)
  assert.equal(db.row()?.notes, 'Reviewed locally')
})
test('custom recurring: edits require exact expected revision, immutable source identity and complete fields', async () => {
  const fields = recurringFields(normalizeCustomRecurring(fixture).record)
  const edit = { version: fixture.version, id: 'missing', expectedRevision: 1, ...fields }
  for (const change of [{ expectedRevision: 0 }, { expectedRevision: 1.1 }, { expectedRevision: '1' }, { sourceKey: fixture.sourceKey }, { importChecksum: 'unsafe' }]) {
    assert.equal(customRecurringEditSchema.safeParse({ ...edit, ...change }).success, false)
  }
  await assert.rejects(editCustomRecurring(edit, memoryStore().store), { status: 404 })
})
test('custom recurring: pagination is bounded and query keys are strict', () => {
  assert.deepEqual(customRecurringQuerySchema.parse({}), { limit: 50 })
  assert.equal(customRecurringQuerySchema.parse({ limit: '100', projectId: fixture.projectId }).limit, 100)
  for (const query of [{ limit: '101' }, { limit: '0' }, { limit: '-1' }, { limit: '1.5' }, { limit: '001' }, { limit: 100 }, { unknown: 'x' }, { after: '../secret' }]) {
    assert.equal(customRecurringQuerySchema.safeParse(query).success, false)
  }
})
test('custom recurring: read DTO allowlists metadata and never infers payment, tax, FX or client charge', () => {
  const now = new Date('2026-11-06T12:00:00Z')
  const dto = customRecurringDto({
    id: 'one', sourceKey: fixture.sourceKey, importChecksum: 'internal-checksum', projectId: fixture.projectId,
    provider: fixture.provider, name: fixture.name, currency: 'USD', amountMinor: 900, recurrence: 'monthly',
    effectiveStart: new Date('2026-11-01'), effectiveEnd: null, active: true, notes: 'Private note',
    revision: 2, createdAt: now, updatedAt: now, project: { slug: 'itrader', name: 'iTrader' },
  })
  assert.equal(dto.paymentStatus, 'unknown')
  assert.equal(dto.taxStatus, 'unknown')
  assert.equal(dto.evidenceKind, 'owner_entered_commitment')
  assert.equal(dto.effectiveStart, '2026-11-01')
  for (const key of ['notes', 'importChecksum', 'history', 'actorId', 'clientId', 'gbpEstimatePence', 'charge']) assert.equal(key in dto, false)
})
test('custom recurring: UI write surfaces are writer-gated and persistence uses atomic revision/audit writes', () => {
  const source = (path: string) => readFileSync(join(process.cwd(), ...path.split('/')), 'utf8')
  const page = source('src/app/costs/custom-recurring/page.tsx')
  assert.match(page, /const user = await requireAuth\(\)/)
  assert.match(page, /const writable = canWrite\(user\)/)
  assert.match(page, /const projects = writable \? await prisma/)
  assert.equal((page.match(/\{writable &&/g) ?? []).length, 2)
  const nav = source('src/app/costs/CostsNav.tsx')
  assert.match(nav, /openToReaders=new Set\([^\n]*'\/costs\/custom-recurring'/)
  const store = source('src/lib/costs/custom-recurring-store.ts')
  assert.match(store, /prisma\.\$transaction/)
  assert.match(store, /pg_advisory_xact_lock/)
  assert.match(store, /where: \{ id: record.id, revision: record.expectedRevision \}/)
  assert.match(store, /if \(changed.count !== 1\) throw new CustomRecurringError\(409/)
  assert.equal((store.match(/await audit\(row, record\)/g) ?? []).length, 2)
  assert.doesNotMatch(store, /costChargeSnapshot|expense\.|invoice\.|costUsageEvent|costPolicy/)
})
