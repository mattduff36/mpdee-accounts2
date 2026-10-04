import { readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import { assertSafeDatabaseUrl } from '../database-target'
import { planInfrastructureImports, type InfraRow } from '../../src/lib/costs/infrastructure-import'
import { projectComparison, type ComparisonEvent } from '../../src/lib/costs/comparison-snapshot'
import { unitsText } from '../../src/lib/costs/money'
import type { FxQuote } from '../../src/lib/costs/fx-values'

const realUrl = 'postgresql://shadow@127.0.0.1:54329/mpdee_accounts_shadow_real'
const cutoff = '2026-08-13T23:00:00.000Z'
const accountRef = 'itrader-vercel-focus'

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
function chunksOf<T>(items: T[], size: number) {
  const out: T[][] = []
  for (let offset = 0; offset < items.length; offset += size) out.push(items.slice(offset, offset + size))
  return out
}

async function main() {
  const identity = assertSafeDatabaseUrl(realUrl, { allowRemote: false })
  if (identity.host !== '127.0.0.1' || identity.port !== '54329' || identity.database !== 'mpdee_accounts_shadow_real') {
    throw new Error('Refusing to write outside the real shadow database')
  }
  process.env.DATABASE_URL = realUrl
  process.env.DATABASE_URL_UNPOOLED = realUrl
  process.env.DIRECT_URL = realUrl
  const [{ prisma }, { hashPassword }, { importUsage }] = await Promise.all([
    import('../../src/lib/db'),
    import('../../src/lib/auth'),
    import('../../src/lib/costs/service'),
  ])
  const accountsEnv = { ...parseEnv('D:/Websites/mpdee-accounts2/.env'), ...parseEnv('D:/Websites/mpdee-accounts2/.env.local') }
  const shadowEnv = parseEnv('D:/Websites/mpdee-accounts2/.env.shadow')
  const itraderEnv = parseEnv('D:/Websites/iommarket/.env.production')
  const source = new pg.Client(connectionConfig(accountsEnv.DATABASE_URL_UNPOOLED))
  await source.connect()
  await source.query('BEGIN READ ONLY')
  const usage = await source.query(`
    SELECT e."accountRef", coalesce(p.slug, 'unassigned') AS slug, r.quality, r.evidence
    FROM "CostUsageEvent" e
    LEFT JOIN "CostProject" p ON p.id = e."projectId"
    JOIN LATERAL (SELECT * FROM "CostUsageRevision" WHERE "eventId" = e.id ORDER BY revision DESC LIMIT 1) r ON true
    WHERE e.provider = 'cursor' AND e."occurredAt" >= $1::timestamptz`, [cutoff])
  const rates = await source.query(`SELECT currency, date::text AS date, "gbpRate"::text AS rate, source FROM "CostFxRate"`)
  await source.query('ROLLBACK')
  await source.end()

  const writer = new pg.Client(connectionConfig(itraderEnv.POSTGRES_URL_NON_POOLING))
  await writer.connect()
  await writer.query('BEGIN READ ONLY')
  const latest = await writer.query(`
    SELECT DISTINCT ON (s."bucketKey")
      s."bucketKey" AS bucket, s.classified, s.quarantined, e."nativeAmount"::text AS amount,
      to_char(e."servicePeriodStart", 'YYYY-MM-DD HH24:MI:SS') AS period_start,
      to_char(e."servicePeriodEnd", 'YYYY-MM-DD HH24:MI:SS') AS period_end,
      e."displayLabel" AS service
    FROM "CostSourceSnapshot" s
    JOIN "CostEntry" e ON e."sourceSnapshotId" = s.id AND e.kind = 'CHARGE'
    WHERE s."sourceKind" = 'VERCEL_FOCUS'
    ORDER BY s."bucketKey", s.revision DESC`)
  const absent = await writer.query(`SELECT count(*)::int AS rows FROM "CostSourceSnapshot" s WHERE s."sourceKind" = 'VERCEL_FOCUS' AND NOT EXISTS (SELECT 1 FROM "CostEntry" e WHERE e."sourceSnapshotId" = s.id AND e.kind = 'CHARGE')`)
  await writer.query('ROLLBACK')
  await writer.end()

  const itraderAccounts = new Set(usage.rows.filter(row => row.slug === 'itrader').map(row => String(row.accountRef)))
  const selected = usage.rows.filter(row => row.slug === 'itrader' || (row.slug === 'unassigned' && itraderAccounts.has(String(row.accountRef))))
  const otherProjects = usage.rows.length - selected.length
  const email = shadowEnv.SHADOW_LOGIN_EMAIL
  const passwordHash = await hashPassword(shadowEnv.SHADOW_LOGIN_PASSWORD)
  await prisma.companySettings.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default', businessName: 'Shadow accounts' } })
  const user = await prisma.user.upsert({ where: { email }, update: { password: passwordHash, isActive: true, role: 'admin' }, create: { email, name: 'Shadow local', password: passwordHash, role: 'admin' } })
  const client = await prisma.client.upsert({ where: { id: 'shadow-client' }, update: { name: 'Shadow client' }, create: { id: 'shadow-client', name: 'Shadow client' } })
  const project = await prisma.costProject.upsert({ where: { slug: 'itrader' }, update: { name: 'iTrader', clientId: client.id, archived: false }, create: { slug: 'itrader', name: 'iTrader', clientId: client.id } })
  const policyScope = `project:${project.id}`
  await prisma.costPolicy.upsert({
    where: { scopeKey_effectiveAt: { scopeKey: policyScope, effectiveAt: new Date(cutoff) } },
    update: { billable: true, includedBaseBps: 5000, markupBps: 0, infrastructureMarkupBps: 0, vercelDailyPence: 0 },
    create: { scopeKey: policyScope, projectId: project.id, effectiveAt: new Date(cutoff), billable: true, includedBaseBps: 5000, markupBps: 0, infrastructureMarkupBps: 0, vercelDailyPence: 0 },
  })
  await prisma.costProjectMapping.upsert({
    where: { type_value: { type: 'workspace', value: 'itrader-attributed' } },
    update: { projectId: project.id },
    create: { type: 'workspace', value: 'itrader-attributed', projectId: project.id },
  })
  for (const rate of rates.rows) {
    await prisma.costFxRate.upsert({
      where: { currency_date: { currency: String(rate.currency), date: new Date(`${rate.date}T00:00:00.000Z`) } },
      update: { gbpRate: String(rate.rate), source: String(rate.source) },
      create: { currency: String(rate.currency), date: new Date(`${rate.date}T00:00:00.000Z`), gbpRate: String(rate.rate), source: String(rate.source) },
    })
  }

  type CursorEvent = { timestamp: string; model?: string; conversationId?: string | null; kind?: string | null; isTokenBasedCall?: boolean | null; chargedCents?: string | null; tokenUsage?: { totalCents?: string | null; inputTokens?: number | null; outputTokens?: number | null; cacheReadTokens?: number | null; cacheWriteTokens?: number | null } | null; workspaceRef?: string }
  const byAccount = new Map<string, CursorEvent[]>()
  let skippedEvidence = 0
  let unsafeAccountRefs = 0
  for (const row of selected) {
    const ref = String(row.accountRef)
    if (!/^[a-zA-Z0-9_-]{3,100}$/.test(ref)) { unsafeAccountRefs += 1; continue }
    const evidence = row.evidence
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) { skippedEvidence += 1; continue }
    const event = evidence as Record<string, unknown>
    const tokenUsage = event.tokenUsage && typeof event.tokenUsage === 'object' && !Array.isArray(event.tokenUsage) ? event.tokenUsage as Record<string, unknown> : null
    const item: CursorEvent = {
      timestamp: String(event.timestamp ?? ''),
      model: typeof event.model === 'string' ? event.model : undefined,
      conversationId: typeof event.conversationId === 'string' ? event.conversationId : null,
      kind: typeof event.kind === 'string' ? event.kind : null,
      isTokenBasedCall: typeof event.isTokenBasedCall === 'boolean' ? event.isTokenBasedCall : null,
      chargedCents: event.chargedCents === null || event.chargedCents === undefined ? null : String(event.chargedCents),
      tokenUsage: tokenUsage ? {
        totalCents: tokenUsage.totalCents === null || tokenUsage.totalCents === undefined ? null : String(tokenUsage.totalCents),
        inputTokens: typeof tokenUsage.inputTokens === 'number' ? tokenUsage.inputTokens : null,
        outputTokens: typeof tokenUsage.outputTokens === 'number' ? tokenUsage.outputTokens : null,
        cacheReadTokens: typeof tokenUsage.cacheReadTokens === 'number' ? tokenUsage.cacheReadTokens : null,
        cacheWriteTokens: typeof tokenUsage.cacheWriteTokens === 'number' ? tokenUsage.cacheWriteTokens : null,
      } : null,
      workspaceRef: row.slug === 'itrader' ? 'itrader-attributed' : undefined,
    }
    const list = byAccount.get(ref) ?? []
    list.push(item)
    byAccount.set(ref, list)
  }
  const cursorPayloads = Array.from(byAccount, ([ref, events]) => ({ provider: 'cursor' as const, accountRef: ref, quality: 'complete' as const, events }))
  const cursorChunks = cursorPayloads.flatMap(payload => chunksOf(payload.events, 400).map(events => ({ ...payload, events })))
  const cursorFirst = []
  for (const chunk of cursorChunks) cursorFirst.push(await importUsage(chunk, user.id))
  const cursorSecond = []
  for (const chunk of cursorChunks) cursorSecond.push(await importUsage(chunk, user.id))

  const databaseResourceIds = [itraderEnv.COST_VERCEL_DATABASE_RESOURCE_ID, itraderEnv.COST_VERCEL_PREVIEW_DATABASE_RESOURCE_ID].filter((value): value is string => Boolean(value))
  const infraRows: InfraRow[] = latest.rows.filter(row => row.classified && !row.quarantined).map(row => {
    const bucket = String(row.bucket)
    return {
      provider: 'vercel' as const, accountRef, sourceId: bucket, billedAmount: String(row.amount), currency: 'USD' as const,
      periodStart: preserveNaive(String(row.period_start)), periodEnd: preserveNaive(String(row.period_end)),
      resourceRef: databaseResourceIds.find(id => bucket.includes(`:${id}:`)) ?? null,
      projectRef: itraderEnv.COST_VERCEL_PROJECT_ID && bucket.includes(`:${itraderEnv.COST_VERCEL_PROJECT_ID}:`) ? 'itrader' : null,
      serviceName: String(row.service || 'Vercel').slice(0, 120),
    }
  })
  const plan = planInfrastructureImports(infraRows, { projectIds: ['itrader'], resourceProjects: Object.fromEntries(databaseResourceIds.slice(0, 1).map(id => [id, ['itrader']])), databaseResourceIds })
  const infraPayload = { provider: 'vercel' as const, accountRef, quality: 'complete' as const, events: plan.accepted.map(event => ({ timestamp: event.periodStart, sourceId: event.sourceKey, billedAmount: event.billedAmount, currency: event.currency, description: event.serviceName, resourceRef: event.billingIdentity.startsWith('vercel-database:') ? event.billingIdentity.slice('vercel-database:'.length) : undefined, workspaceRef: event.projectId === 'itrader' ? 'itrader-attributed' : undefined })) }
  const infraChunks = chunksOf(infraPayload.events, 500).map(events => ({ ...infraPayload, events }))
  const infraFirst = []
  for (const chunk of infraChunks) infraFirst.push(await importUsage(chunk, user.id))
  const infraSecond = []
  for (const chunk of infraChunks) infraSecond.push(await importUsage(chunk, user.id))

  const stored = await prisma.costUsageEvent.findMany({
    select: {
      id: true, provider: true, accountRef: true, sourceKey: true, occurredAt: true, projectId: true, attribution: true,
      revisions: { orderBy: { revision: 'desc' }, take: 1, select: { funding: true, nominalUnits: true, providerUnits: true, currency: true, quality: true } },
    },
  })
  const quotes: FxQuote[] = rates.rows.map(rate => ({ currency: String(rate.currency), date: String(rate.date).slice(0, 10), rate: String(rate.rate), source: String(rate.source) }))
  const events: ComparisonEvent[] = stored.map(event => {
    const revision = event.revisions[0]
    return {
      id: event.id, provider: event.provider, accountRef: event.accountRef, sourceKey: event.sourceKey, occurredAt: event.occurredAt, projectId: event.projectId,
      funding: revision?.funding ?? 'unknown', nominalUnits: revision?.nominalUnits ?? null, providerUnits: revision?.providerUnits ?? null, currency: revision?.currency ?? 'unknown',
      quality: revision?.quality ?? 'missing', attribution: event.attribution, hold: null, coveredByProviderInvoice: false, fx: null,
    }
  })
  const comparison = projectComparison({ project: 'itrader', asOf: new Date(), from: cutoff, events: events.filter(event => event.projectId === project.id || event.projectId === null), sourceUpdatedAt: null, storedPolicies: null, documents: { providerInvoicePence: null, providerCreditPence: null, customerCreditPence: null, customerPaymentPence: null, vatPence: null, prepaidPence: null }, approvedClientChargePence: null, referenceQuotes: quotes })
  const snapshots = await prisma.costChargeSnapshot.count()
  const providerUnits = stored.filter(event => event.provider === 'vercel').reduce((total, event) => total + (event.revisions[0]?.providerUnits ?? BigInt(0)), BigInt(0))
  const artifact = {
    generatedAt: new Date().toISOString(),
    dataset: 'mpdee_accounts_shadow_real',
    fixtureSnapshotPence: snapshots,
    scope: { source: 'Accounts cursor usage and iTrader FOCUS charges, read-only then imported locally', cutoff, currency: 'USD' },
    cursor: {
      sourceEvents: usage.rows.length,
      imported: selected.length - unsafeAccountRefs - skippedEvidence,
      otherProjectsLeftOut: otherProjects,
      skippedEvidence,
      unsafeAccountRefs,
      firstAdded: cursorFirst.reduce((total, row) => total + row.added, 0),
      replayAdded: cursorSecond.reduce((total, row) => total + row.added, 0),
      replayDuplicate: cursorSecond.reduce((total, row) => total + row.duplicate, 0),
    },
    infrastructure: {
      accepted: plan.accepted.length,
      rejected: plan.rejected.length,
      mappedToItrader: plan.accepted.filter(row => row.projectId === 'itrader').length,
      unassigned: plan.accepted.filter(row => row.projectId === null).length,
      snapshotsWithoutCharge: absent.rows[0].rows,
      replayAdded: infraSecond.reduce((total, row) => total + row.added, 0),
      replayDuplicate: infraSecond.reduce((total, row) => total + row.duplicate, 0),
      importedProviderUnits: providerUnits.toString(),
      importedProviderUsd: unitsText(providerUnits),
    },
    comparison: {
      events: comparison.coverage.events,
      held: comparison.coverage.held,
      unassigned: comparison.coverage.unassigned,
      fxMissingPence: comparison.coverage.fxMissing,
      unionUnresolved: comparison.coverage.overlap.unionUnresolved,
      outstandingPence: comparison.outstanding.pence,
      totals: comparison.totals,
    },
  }
  const sourceUnits = process.env.COST_SHADOW_SOURCE_UNITS
  if (snapshots !== 0) throw new Error('Real dataset must not contain an approved fixture snapshot')
  if (artifact.cursor.replayAdded !== 0 || artifact.infrastructure.replayAdded !== 0) throw new Error('Real import replay added rows')
  if (sourceUnits && /^\d+$/.test(sourceUnits)) {
    const expected = BigInt(sourceUnits)
    const drift = providerUnits > expected ? providerUnits - expected : expected - providerUnits
    if (drift > 100_000n) throw new Error('Infrastructure total drifted from the supplied source units')
  }
  writeFileSync('D:/Websites/mpdee-accounts2/docs/costs/live-shadow-stage3-real.json', JSON.stringify(artifact, null, 2))
  const prior = parseEnv('D:/Websites/mpdee-accounts2/.env.shadow')
  writeFileSync('D:/Websites/mpdee-accounts2/.env.shadow.real', [
    `DATABASE_URL=${realUrl}`,
    `DATABASE_URL_UNPOOLED=${realUrl}`,
    `DIRECT_URL=${realUrl}`,
    `SESSION_SECRET=${prior.SESSION_SECRET}`,
    `SHADOW_LOGIN_EMAIL=${prior.SHADOW_LOGIN_EMAIL}`,
    `SHADOW_LOGIN_PASSWORD=${prior.SHADOW_LOGIN_PASSWORD}`,
    `COSTS_PROJECT_READ_TOKEN_SHA256_BY_SLUG=${prior.COSTS_PROJECT_READ_TOKEN_SHA256_BY_SLUG}`,
    `COST_ACCOUNTS_READ_TOKEN=${prior.COST_ACCOUNTS_READ_TOKEN}`,
    'COST_SHADOW_UI=1',
    'COST_COMPARISON_DATASET=real-shadow',
    'COST_ACCOUNTS_COMPARISON_ORIGIN=http://127.0.0.1:3310',
  ].join('\n') + '\n')
  console.log(JSON.stringify(artifact, null, 2))
  await prisma.$disconnect()
}
main()
