import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LEDGER_START } from './comparison-policy'
import { chargeUnits, decimalUnits } from './money'
import { importSchema, normalize } from './normalize'
import { exactVercelResourceMapping, planItraderFocusImport } from './itrader-focus-import'
import { parseItraderFocusArgs, runItraderFocusCli } from '../../../scripts/costs/import-itrader-focus'

const NOW = new Date('2026-10-10T12:00:00.000Z')
const PROJECT = 'prj_example'
const ACCOUNT = 'team-itrader'
const START = '2026-09-01T07:00:00.000Z'
const END = '2026-09-02T07:00:00.000Z'
const CHECKSUM = 'ab'.repeat(32)
const PRECISE = '900719925.4740993'
const GOLDEN = 'vercel:VERCEL_HOSTING:prj_example:Fast Origin Transfer:Data Transfer:Usage:On-Demand:GB:GB:iad1:2026-09-01T07:00:00.000Z:2026-09-02T07:00:00.000Z'

function bucket(input: {
  category?: string
  projectRef?: string
  serviceName?: string
  chargeCategory?: string
  periodStart?: string
  periodEnd?: string
} = {}) {
  const periodStart = input.periodStart ?? START
  const periodEnd = input.periodEnd ?? END
  return [
    'vercel',
    input.category ?? 'VERCEL_HOSTING',
    input.projectRef ?? PROJECT,
    input.serviceName ?? 'Fast Origin Transfer',
    'Data Transfer',
    input.chargeCategory ?? 'Usage',
    'On-Demand',
    'GB',
    'GB',
    'iad1',
    periodStart,
    periodEnd,
  ].join(':')
}

function row(overrides: Record<string, unknown> = {}) {
  const periodStart = typeof overrides.periodStart === 'string' ? overrides.periodStart : START
  const periodEnd = typeof overrides.periodEnd === 'string' ? overrides.periodEnd : END
  const serviceName = Object.prototype.hasOwnProperty.call(overrides, 'serviceName') ? overrides.serviceName : 'Fast Origin Transfer'
  const sourceId = typeof overrides.sourceId === 'string'
    ? overrides.sourceId
    : bucket({
      category: typeof overrides.idCategory === 'string' ? overrides.idCategory : undefined,
      projectRef: typeof overrides.projectRef === 'string' ? overrides.projectRef : undefined,
      serviceName: typeof serviceName === 'string' ? serviceName : 'Fast Origin Transfer',
      chargeCategory: typeof overrides.chargeCategory === 'string' ? overrides.chargeCategory : undefined,
      periodStart,
      periodEnd,
    })
  return {
    revision: 1,
    checksum: CHECKSUM,
    periodStart,
    periodEnd,
    classified: true,
    quarantined: false,
    quarantineReason: null,
    category: 'VERCEL_HOSTING',
    billedAmount: '1.25',
    currency: 'USD',
    serviceName,
    ...overrides,
    sourceId,
  }
}

function envelope(rows: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    version: 'itrader-focus-export-v1',
    exportedAt: '2026-10-10T11:00:00.000Z',
    sourceReadOnly: true,
    accountRef: ACCOUNT,
    sourceProjectRef: PROJECT,
    databaseResourceRefs: ['db_example'],
    rows,
    ...overrides,
  }
}

function plan(rows: unknown[], config: { chunkSize?: number; accountRef?: string; projectRef?: string } = {}) {
  return planItraderFocusImport(envelope(rows), {
    accountRef: config.accountRef ?? ACCOUNT,
    projectRef: config.projectRef ?? PROJECT,
    now: NOW,
    chunkSize: config.chunkSize,
  })
}

test('golden hosting row keeps the native decimal, exact source id and normalizer identity', () => {
  const result = plan([row({ sourceId: GOLDEN, billedAmount: PRECISE, markedGbpMinor: 999, displayAmount: '60.00' })])
  assert.equal(result.ok, true)
  assert.equal(result.accepted, 1)
  assert.equal(result.payloads.length, 1)
  const event = result.payloads[0].events[0]
  assert.equal(event.sourceId, GOLDEN)
  assert.equal(event.billedAmount, PRECISE)
  assert.equal(event.timestamp, START)
  assert.equal(event.resourceRef, PROJECT)
  assert.equal(event.description, 'Fast Origin Transfer')
  assert.equal(result.payloads[0].accountRef, ACCOUNT)
  assert.equal(result.payloads[0].provider, 'vercel')
  assert.equal(result.audit[0].checksum, CHECKSUM)
  assert.equal(JSON.stringify(result.payloads).includes('999'), false)
  const parsed = importSchema.parse(result.payloads[0])
  const [normalized] = normalize(parsed)
  assert.equal(normalized.sourceKey, `${GOLDEN}:0`)
  assert.equal(normalized.cash, decimalUnits(PRECISE))
  assert.equal(normalized.cash > BigInt(Number.MAX_SAFE_INTEGER), true)
  const face = { billable: true, includedBaseBps: 5000, markupBps: 0, infrastructureMarkupBps: 0 }
  const stale = { billable: true, includedBaseBps: 6000, markupBps: 11000, infrastructureMarkupBps: 10000 }
  const input = { provider: 'vercel', funding: 'infrastructure', nominal: normalized.nominal, cash: normalized.cash, model: null }
  assert.equal(chargeUnits(input, face), normalized.cash)
  assert.equal(chargeUnits(input, stale), normalized.cash)
  const replay = plan([row({ sourceId: GOLDEN, billedAmount: PRECISE })])
  assert.deepEqual(replay.payloads, result.payloads)
})

test('zero, credit and adjustment signs stay, and the same resource on another day is kept', () => {
  const nextStart = '2026-09-03T07:00:00.000Z'
  const nextEnd = '2026-09-04T07:00:00.000Z'
  const result = plan([
    row({ billedAmount: '0' }),
    row({ chargeCategory: 'Credit', billedAmount: '-1.2500000', serviceName: 'Credit note' }),
    row({ chargeCategory: 'Adjustment', billedAmount: '-0.10', serviceName: 'Adjustment' }),
    row({ periodStart: nextStart, periodEnd: nextEnd, billedAmount: '2.00' }),
  ])
  assert.equal(result.ok, true)
  assert.deepEqual(result.payloads[0].events.map(event => event.billedAmount), ['0', '-1.2500000', '-0.10', '2.00'])
  assert.equal(result.payloads[0].events[3].sourceId.includes(nextStart), true)
  assert.deepEqual(result.payloads[0].events.map(event => event.resourceRef), [PROJECT, PROJECT, PROJECT, PROJECT])
  const normalized = normalize(importSchema.parse(result.payloads[0]))
  assert.deepEqual(normalized.map(item => item.sourceKey.endsWith(':0')), [true, true, true, true])
  assert.equal(normalized[1].cash, decimalUnits('-1.2500000'))
})

test('tax, shared, quarantine, foreign, database, membership and pre-boundary rows stay out', () => {
  const result = plan([
    row({ chargeCategory: 'Tax', billedAmount: '0.20', serviceName: 'Tax' }),
    row({ idCategory: 'SHARED_VERCEL', category: 'SHARED_VERCEL', projectRef: 'shared', serviceName: 'Platform' }),
    row({ quarantined: true, quarantineReason: 'held' }),
    row({ projectRef: 'prj_other', serviceName: 'Other project' }),
    row({ idCategory: 'DATABASE', category: 'DATABASE', projectRef: 'db_example', serviceName: 'Postgres' }),
    row({ sourceId: 'vercel:membership:2026-09-01', serviceName: 'Membership' }),
    row({ periodStart: '2026-08-13T22:00:00.000Z', periodEnd: '2026-08-14T22:00:00.000Z' }),
    row({ classified: false, category: null, serviceName: 'Unknown' }),
  ])
  assert.equal(result.ok, true)
  assert.equal(result.accepted, 0)
  assert.equal(result.excluded, 8)
  assert.deepEqual(result.excludedReasons, {
    'before-boundary': 1,
    database: 1,
    'foreign-project': 1,
    quarantine: 1,
    shared: 1,
    'synthetic-membership': 1,
    tax: 1,
    unclassified: 1,
  })
})

test('invalid, future, inverted, duplicate and conflicting rows are rejected without a payload', () => {
  const duplicated = row({ billedAmount: '1.00' })
  const conflict = row({ billedAmount: '9.00', revision: 2 })
  const result = plan([
    row({ periodStart: '2026-09-01', periodEnd: END, serviceName: 'Bad period' }),
    row({ periodStart: '2026-11-01T00:00:00.000Z', periodEnd: '2026-11-02T00:00:00.000Z', serviceName: 'Future' }),
    row({ periodStart: END, periodEnd: START, serviceName: 'Inverted' }),
    duplicated,
    conflict,
    row({ billedAmount: 1.5, serviceName: 'Numeric amount' }),
    row({ chargeCategory: 'Usage', billedAmount: '-2.00', serviceName: 'Negative usage' }),
    row({ currency: 'JPY', serviceName: 'Foreign currency' }),
  ])
  assert.equal(result.ok, false)
  assert.equal(result.accepted, 0)
  assert.equal(result.payloads.length, 0)
  assert.equal(result.rejectedReasons['invalid-period'], 1)
  assert.equal(result.rejectedReasons['future-start'], 1)
  assert.equal(result.rejectedReasons['inverted-period'], 1)
  assert.equal(result.rejectedReasons['conflicting-identity'], 2)
  assert.equal(result.rejectedReasons['row-shape'], 1)
  assert.equal(result.rejectedReasons['negative-amount'], 1)
  assert.equal(result.rejectedReasons['unsupported-currency'], 1)
  const mismatch = plan([row({ serviceName: 'Mismatch' })], { accountRef: 'other-team' })
  assert.equal(mismatch.accepted, 0)
  assert.equal(mismatch.rejectedReasons['account-mismatch'], 1)
  assert.equal(mismatch.payloads.length, 0)
})

test('service names that contain colons stay intact and chunks stay at or below 5000', () => {
  const colonName = 'Edge: Request'
  const colonId = bucket({ serviceName: colonName })
  const rows = [row({ sourceId: colonId, serviceName: colonName, billedAmount: '0.01' }), row({ billedAmount: '0.02' }), row({ periodStart: '2026-09-05T07:00:00.000Z', periodEnd: '2026-09-06T07:00:00.000Z', billedAmount: '0.03' })]
  const result = plan(rows, { chunkSize: 2 })
  assert.equal(result.payloads.length, 2)
  assert.equal(result.payloads[0].events.length, 2)
  assert.equal(result.payloads[1].events.length, 1)
  assert.equal(result.payloads[0].events[0].sourceId, colonId)
  assert.equal(result.payloads[0].events[0].description, colonName)
  assert.throws(() => plan(rows, { chunkSize: 5001 }), /5000/)
  assert.equal(exactVercelResourceMapping(
    { slug: 'itrader', mappings: [{ type: 'workspace', value: 'shop' }, { type: 'vercel-resource', value: PROJECT }] },
    { slug: 'itrader', projectRef: PROJECT },
  ).ok, true)
  assert.equal(exactVercelResourceMapping(
    { slug: 'itrader', mappings: [{ type: 'vercel-resource', value: 'prj_other' }] },
    { slug: 'itrader', projectRef: PROJECT },
  ).ok, false)
})

test('CLI dry-run validates mapping and apply is the only write path', async () => {
  const local = 'postgres://user:secret@127.0.0.1:5432/accounts'
  const input = JSON.stringify(envelope([row({ sourceId: GOLDEN, billedAmount: PRECISE })]))
  let writes = 0
  let reads = 0
  const deps = {
    readText: () => input,
    now: NOW,
    databaseUrl: local,
    loadProject: async () => {
      reads += 1
      return { slug: 'itrader', mappings: [{ type: 'vercel-resource', value: PROJECT }] }
    },
    applyPayloads: async () => {
      writes += 1
      return { added: 1, revised: 2, duplicate: 3, unassigned: 0 }
    },
  }
  const args = ['--input', 'fixture.json', '--project', 'itrader', '--project-ref', PROJECT, '--account-ref', ACCOUNT]
  const dry = await runItraderFocusCli(args, deps)
  assert.equal(dry.exitCode, 0)
  assert.equal(writes, 0)
  assert.equal(reads, 1)
  assert.equal(dry.stdout.includes(PRECISE), false)
  assert.equal(dry.stdout.includes('secret'), false)
  assert.equal(dry.stdout.includes('postgres://'), false)
  const dryBody = JSON.parse(dry.stdout)
  assert.equal(dryBody.mode, 'dry-run')
  assert.equal(dryBody.duplicate, null)
  assert.equal(dryBody.revised, null)
  const applied = await runItraderFocusCli([...args, '--apply'], deps)
  assert.equal(applied.exitCode, 0)
  assert.equal(writes, 1)
  const appliedBody = JSON.parse(applied.stdout)
  assert.equal(appliedBody.added, 1)
  assert.equal(appliedBody.revised, 2)
  assert.equal(appliedBody.duplicate, 3)
  const remote = await runItraderFocusCli(args, { ...deps, databaseUrl: 'postgres://user:secret@db.example/accounts', loadProject: async () => { throw new Error('should not read') } })
  assert.equal(remote.exitCode, 1)
  assert.equal(remote.stderr.includes('postgres://'), false)
  assert.equal(remote.stderr.includes('secret'), false)
  assert.equal(remote.stdout.includes('secret'), false)
  const rejected = await runItraderFocusCli([...args, '--apply'], {
    ...deps,
    readText: () => JSON.stringify(envelope([row({ billedAmount: 1 })])),
    applyPayloads: async () => { throw new Error('should not write') },
  })
  assert.equal(rejected.exitCode, 1)
  assert.equal(writes, 1)
  assert.throws(() => parseItraderFocusArgs([...args, '--allow-remote-db']), /Remote database override/)
})
