import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import { assertSafeDatabaseUrl } from '../database-target'
import { planInfrastructureImports, type InfraRow } from '../../src/lib/costs/infrastructure-import'
import { freezeChargeSnapshot, replayChargeSnapshot } from '../../src/lib/costs/charge-snapshot'
import { COMPARISON_POLICY_VERSION } from '../../src/lib/costs/comparison-policy'
import { matchProviderBills, allocationConserves } from '../../src/lib/costs/bill-match'

const shadowUrl = 'postgresql://shadow@127.0.0.1:54329/mpdee_accounts_shadow'
const accountRef = 'itrader-vercel-focus'
const cursorAccount = 'shadow-cursor'

function parseEnv(file: string) {
  const out: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const index = trimmed.indexOf('=')
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    out[trimmed.slice(0, index).trim()] = value
  }
  return out
}

function assertShadow() {
  const identity = assertSafeDatabaseUrl(shadowUrl, { allowRemote: false })
  if (identity.host !== '127.0.0.1' || identity.port !== '54329' || identity.database !== 'mpdee_accounts_shadow') {
    throw new Error('Refusing to write outside the local shadow database')
  }
}

function connectionConfig(raw: string) {
  const url = new URL(raw)
  url.searchParams.delete('sslmode')
  url.searchParams.delete('ssl')
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: false } }
}

function preserveNaive(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(value)
  if (!match) throw new Error('Infrastructure period is not a naive timestamp')
  return `${match[1]}T${match[2]}.000Z`
}

async function readFocus(raw: string, databaseResourceIds: string[], itraderProjectId: string) {
  const db = new pg.Client(connectionConfig(raw))
  await db.connect()
  try {
    await db.query('BEGIN READ ONLY')
    const counts = await db.query(`
      SELECT "sourceKind"::text AS kind, count(*)::int AS rows
      FROM "CostSourceSnapshot" GROUP BY 1`)
    const membership = await db.query(`SELECT count(*)::int AS rows FROM "CostSourceSnapshot" WHERE "bucketKey" LIKE 'vercel:membership:%'`)
    const latest = await db.query(`
      SELECT DISTINCT ON (s."bucketKey")
        s."bucketKey" AS bucket, s.classified, s.quarantined, e.category::text AS category,
        e."nativeAmount"::text AS amount, e."nativeCurrency" AS currency,
        to_char(e."servicePeriodStart", 'YYYY-MM-DD HH24:MI:SS') AS period_start,
        to_char(e."servicePeriodEnd", 'YYYY-MM-DD HH24:MI:SS') AS period_end,
        e."displayLabel" AS service
      FROM "CostSourceSnapshot" s
      JOIN "CostEntry" e ON e."sourceSnapshotId" = s.id AND e.kind = 'CHARGE'
      WHERE s."sourceKind" = 'VERCEL_FOCUS'
      ORDER BY s."bucketKey", s.revision DESC`)
    await db.query('ROLLBACK')
    const rows: InfraRow[] = []
    let tooLong = 0, quarantined = 0, maxIdentity = 0
    for (const row of latest.rows) {
      const bucket = String(row.bucket)
      maxIdentity = Math.max(maxIdentity, bucket.length)
      if (bucket.length > 1000) { tooLong += 1; continue }
      if (row.quarantined || !row.classified) { quarantined += 1; continue }
      const resourceRef = databaseResourceIds.find(id => bucket.includes(`:${id}:`)) ?? null
      rows.push({
        provider: 'vercel', accountRef, sourceId: bucket, billedAmount: String(row.amount), currency: 'USD',
        periodStart: preserveNaive(String(row.period_start)), periodEnd: preserveNaive(String(row.period_end)),
        resourceRef, projectRef: itraderProjectId && bucket.includes(`:${itraderProjectId}:`) ? 'itrader' : null,
        serviceName: String(row.service || 'Vercel').slice(0, 120), frozenClientCharge: false,
      })
    }
    return { counts: counts.rows, membership: membership.rows[0].rows as number, tooLong, quarantined, maxIdentity, rows }
  } finally { await db.end() }
}

async function main() {
  assertShadow()
  process.env.DATABASE_URL = shadowUrl
  process.env.DATABASE_URL_UNPOOLED = shadowUrl
  process.env.DIRECT_URL = shadowUrl
  const [{ prisma }, { hashPassword }, { importUsage }] = await Promise.all([
    import('../../src/lib/db'),
    import('../../src/lib/auth'),
    import('../../src/lib/costs/service'),
  ])
  const itraderEnv = parseEnv('D:/Websites/iommarket/.env.production')
  const databaseResourceIds = [itraderEnv.COST_VERCEL_DATABASE_RESOURCE_ID, itraderEnv.COST_VERCEL_PREVIEW_DATABASE_RESOURCE_ID].filter((value): value is string => Boolean(value))
  const focus = await readFocus(itraderEnv.POSTGRES_URL_NON_POOLING, databaseResourceIds, itraderEnv.COST_VERCEL_PROJECT_ID ?? '')
  const plan = planInfrastructureImports(focus.rows, {
    projectIds: ['itrader'],
    resourceProjects: Object.fromEntries(databaseResourceIds.slice(0, 1).map(id => [id, ['itrader']])),
    databaseResourceIds,
  })
  const email = 'shadow-local@example.com'
  const password = randomBytes(18).toString('base64url')
  const sessionSecret = randomBytes(32).toString('base64url')
  const readToken = randomBytes(32).toString('base64url')
  const digest = createHash('sha256').update(readToken, 'utf8').digest('hex')
  const passwordHash = await hashPassword(password)
  await prisma.companySettings.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default', businessName: 'Shadow accounts' } })
  const user = await prisma.user.upsert({
    where: { email }, update: { password: passwordHash, isActive: true, role: 'admin' },
    create: { email, name: 'Shadow local', password: passwordHash, role: 'admin' },
  })
  const client = await prisma.client.upsert({ where: { id: 'shadow-client' }, update: { name: 'Shadow client' }, create: { id: 'shadow-client', name: 'Shadow client' } })
  const project = await prisma.costProject.upsert({
    where: { slug: 'itrader' }, update: { name: 'iTrader', clientId: client.id, archived: false },
    create: { slug: 'itrader', name: 'iTrader', clientId: client.id },
  })
  const policyScope = `project:${project.id}`
  await prisma.costPolicy.upsert({
    where: { scopeKey_effectiveAt: { scopeKey: policyScope, effectiveAt: new Date('2026-08-13T23:00:00.000Z') } },
    update: { billable: true, includedBaseBps: 5000, markupBps: 0, infrastructureMarkupBps: 0, vercelDailyPence: 0 },
    create: { scopeKey: policyScope, projectId: project.id, effectiveAt: new Date('2026-08-13T23:00:00.000Z'), billable: true, includedBaseBps: 5000, markupBps: 0, infrastructureMarkupBps: 0, vercelDailyPence: 0 },
  })
  await prisma.costProjectMapping.upsert({
    where: { type_value: { type: 'workspace', value: 'shadow-workspace' } },
    update: { projectId: project.id },
    create: { type: 'workspace', value: 'shadow-workspace', projectId: project.id },
  })
  await prisma.costFxRate.upsert({
    where: { currency_date: { currency: 'USD', date: new Date('2026-09-25T00:00:00.000Z') } },
    update: { gbpRate: '0.75000000', source: 'Shadow dated reference' },
    create: { currency: 'USD', date: new Date('2026-09-25T00:00:00.000Z'), gbpRate: '0.75000000', source: 'Shadow dated reference' },
  })
  const knownPayload = {
    provider: 'cursor' as const, accountRef: cursorAccount, quality: 'complete' as const, fxGbp: '0.75000000',
    events: [{ timestamp: '2026-10-02T12:00:00.000Z', model: 'shadow-model', kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO', isTokenBasedCall: true, chargedCents: '0', tokenUsage: { totalCents: '1000', inputTokens: 10, outputTokens: 2 }, workspaceRef: 'shadow-workspace', conversationId: 'shadow-known' }],
  }
  const known = await importUsage(knownPayload, user.id)
  const knownReplay = await importUsage(knownPayload, user.id)
  const open = await importUsage({
    provider: 'cursor', accountRef: cursorAccount, quality: 'complete',
    events: [{ timestamp: '2026-10-03T12:00:00.000Z', model: 'shadow-model', kind: 'USAGE_EVENT_KIND_USAGE_BASED', isTokenBasedCall: true, chargedCents: '250', tokenUsage: { totalCents: '250', inputTokens: 4, outputTokens: 1 }, conversationId: 'shadow-open' }],
  }, user.id)
  const category = await prisma.expenseCategory.upsert({ where: { name: 'Shadow infrastructure' }, update: {}, create: { name: 'Shadow infrastructure' } })
  await prisma.expense.upsert({
    where: { id: 'shadow-vercel-overhead' }, update: { netAmount: 5520, grossAmount: 5520, vatAmount: 0 },
    create: { id: 'shadow-vercel-overhead', categoryId: category.id, date: new Date('2026-09-30T00:00:00.000Z'), supplier: 'Vercel', description: 'Sanitized subscription overhead', netAmount: 5520, vatAmount: 0, grossAmount: 5520, vatRate: 0, reference: 'shadow-overhead' },
  })
  const overhead = matchProviderBills([{ id: 'shadow-overhead', provider: 'vercel', accountRef: null, service: 'subscription', periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-10-01T00:00:00.000Z', netPence: 5520 }], [])
  const payloads = new Map<string, { provider: 'vercel'; accountRef: string; quality: 'complete'; events: { timestamp: string; sourceId: string; billedAmount: string; currency: 'USD'; description: string; resourceRef?: string; workspaceRef?: string }[] }>()
  for (const event of plan.accepted) {
    const key = event.accountRef
    const payload = payloads.get(key) ?? { provider: 'vercel' as const, accountRef: event.accountRef, quality: 'complete' as const, events: [] }
    if (event.currency !== 'USD') throw new Error('Shadow fixture infrastructure is USD')
    payload.events.push({
      timestamp: event.periodStart, sourceId: event.sourceKey, billedAmount: event.billedAmount, currency: event.currency,
      description: event.serviceName, resourceRef: event.billingIdentity.startsWith('vercel-database:') ? event.billingIdentity.slice('vercel-database:'.length) : undefined,
      workspaceRef: event.projectId === 'itrader' ? 'shadow-workspace' : undefined,
    })
    payloads.set(key, payload)
  }
  const chunks = []
  for (const payload of payloads.values()) {
    for (let offset = 0; offset < payload.events.length; offset += 500) chunks.push({ ...payload, events: payload.events.slice(offset, offset + 500) })
  }
  const first = []
  for (const chunk of chunks) first.push(await importUsage(chunk, user.id))
  const second = []
  for (const chunk of chunks) second.push(await importUsage(chunk, user.id))
  const frozen = freezeChargeSnapshot({
    projectId: project.id, policyVersion: COMPARISON_POLICY_VERSION, allocationMethod: null, sourceRevisionIds: ['shadow-revision'],
    currency: 'GBP', fxSource: null, fxDate: null, fxRate: null, usageValueUnits: null, providerCostUnits: null,
    clientChargePence: 1234, outstandingPence: 1234, invoiceId: null, paymentId: null, replacesSnapshotId: null, evidence: { fixture: 'shadow' },
  })
  const existingSnapshot = await prisma.costChargeSnapshot.findUnique({ where: { id: frozen.id }, select: { id: true } })
  if (!existingSnapshot) await prisma.costChargeSnapshot.create({ data: { id: frozen.id, projectId: project.id, policyVersion: frozen.policyVersion, allocationMethod: frozen.allocationMethod, sourceRevisionIds: frozen.sourceRevisionIds, currency: frozen.currency, clientChargePence: frozen.clientChargePence, outstandingPence: frozen.outstandingPence, verificationStatus: frozen.verificationStatus, evidence: frozen.evidence } })
  const before = await prisma.costChargeSnapshot.findUniqueOrThrow({ where: { id: frozen.id }, select: { clientChargePence: true, createdAt: true } })
  const replayAfterImport = replayChargeSnapshot([frozen.id], freezeChargeSnapshot({
    projectId: project.id, policyVersion: COMPARISON_POLICY_VERSION, allocationMethod: null, sourceRevisionIds: ['shadow-revision'],
    currency: 'GBP', fxSource: null, fxDate: null, fxRate: null, usageValueUnits: null, providerCostUnits: null,
    clientChargePence: 1234, outstandingPence: 1234, invoiceId: null, paymentId: null, replacesSnapshotId: null, evidence: { fixture: 'shadow' },
  }))
  let updateBlocked = false
  try { await prisma.$executeRaw`UPDATE "CostChargeSnapshot" SET "clientChargePence" = 1 WHERE id = ${frozen.id}` } catch (error) { updateBlocked = error instanceof Error && error.message.includes('append-only') }
  const after = await prisma.costChargeSnapshot.findUniqueOrThrow({ where: { id: frozen.id }, select: { clientChargePence: true, createdAt: true } })
  const artifact = {
    generatedAt: new Date().toISOString(),
    database: '127.0.0.1:54329/mpdee_accounts_shadow',
    cursor: { knownAdded: known.added, knownReplayAdded: knownReplay.added, knownReplayDuplicate: knownReplay.duplicate, openAdded: open.added },
    infrastructure: {
      sourceKinds: focus.counts, membershipSnapshots: focus.membership, plannerExcluded: plan.excluded.length,
      quarantined: focus.quarantined, identityTooLong: focus.tooLong, maxIdentityLength: focus.maxIdentity, accepted: plan.accepted.length, rejected: plan.rejected.length,
      rejectionReasons: Array.from(plan.rejected.reduce((counts, row) => counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1), new Map<string, number>()), ([reason, count]) => ({ reason, count })),
      mappedToItrader: plan.accepted.filter(row => row.projectId === 'itrader').length,
      unassigned: plan.accepted.filter(row => row.projectId === null).length,
    },
    replay: {
      firstAdded: first.reduce((total, row) => total + row.added, 0),
      secondAdded: second.reduce((total, row) => total + row.added, 0),
      secondDuplicate: second.reduce((total, row) => total + row.duplicate, 0),
    },
    snapshot: { replayAdded: replayAfterImport.added, updateBlocked, penceUnchanged: before.clientChargePence === 1234 && after.clientChargePence === 1234 && before.createdAt.getTime() === after.createdAt.getTime() },
    overhead: { conserved: allocationConserves([{ id: 'shadow-overhead', provider: 'vercel', accountRef: null, service: 'subscription', periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-10-01T00:00:00.000Z', netPence: 5520 }], overhead), unallocatedPence: overhead.unallocated.reduce((total, row) => total + row.pence, 0), suppressed: overhead.suppressedEventIds.length },
  }
  if (knownReplay.added !== 0 || knownReplay.duplicate !== 1) throw new Error('Cursor replay did not leave the import unchanged')
  if (chunks.length > 0 && (artifact.replay.secondAdded !== 0 || artifact.replay.secondDuplicate < 1)) throw new Error('Infrastructure replay did not leave the import unchanged')
  if (!artifact.snapshot.updateBlocked || !artifact.snapshot.penceUnchanged || artifact.snapshot.replayAdded !== 0) throw new Error('Approved snapshot was not immutable')
  writeFileSync('D:/Websites/mpdee-accounts2/docs/costs/live-shadow-stage2-shadow.json', JSON.stringify(artifact, null, 2))
  writeFileSync('D:/Websites/mpdee-accounts2/.env.shadow', [
    `DATABASE_URL=${shadowUrl}`,
    `DATABASE_URL_UNPOOLED=${shadowUrl}`,
    `DIRECT_URL=${shadowUrl}`,
    `SESSION_SECRET=${sessionSecret}`,
    `SHADOW_LOGIN_EMAIL=${email}`,
    `SHADOW_LOGIN_PASSWORD=${password}`,
    `COSTS_PROJECT_READ_TOKEN_SHA256_BY_SLUG=${JSON.stringify({ itrader: digest })}`,
    `COST_ACCOUNTS_READ_TOKEN=${readToken}`,
    'COST_SHADOW_UI=1',
    'COST_ACCOUNTS_COMPARISON_ORIGIN=http://127.0.0.1:3310',
  ].join('\n') + '\n')
  console.log(JSON.stringify(artifact, null, 2))
  await prisma.$disconnect()
}
main()
