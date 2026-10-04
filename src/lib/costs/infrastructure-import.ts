import { COMPARISON_POLICY_VERSION } from './comparison-policy'

export type InfraRow = {
  provider: 'vercel' | 'supabase' | 'manual'
  accountRef: string
  sourceId: string
  billedAmount: string
  currency: 'USD' | 'GBP' | 'EUR'
  periodStart: string
  periodEnd: string
  resourceRef?: string | null
  projectRef?: string | null
  serviceName: string
  frozenClientCharge?: boolean
}

export type InfraPlanConfig = {
  projectIds: string[]
  resourceProjects: Record<string, string[]>
  databaseResourceIds: string[]
}

export type PlannedInfraEvent = {
  provider: 'vercel' | 'supabase' | 'manual'
  accountRef: string
  sourceKey: string
  billingIdentity: string
  projectId: string | null
  attribution: 'mapped' | 'unassigned' | 'conflict'
  category: 'VERCEL_HOSTING' | 'DATABASE' | 'OTHER'
  billedAmount: string
  currency: InfraRow['currency']
  periodStart: string
  periodEnd: string
  serviceName: string
}

function projectsFor(row: InfraRow, config: InfraPlanConfig) {
  const fromResource = row.resourceRef ? config.resourceProjects[row.resourceRef] ?? [] : []
  const fromProject = row.projectRef && config.projectIds.includes(row.projectRef) ? [row.projectRef] : []
  return Array.from(new Set([...fromResource, ...fromProject]))
}

/**
 * Plan an infrastructure delta. Vercel-billed database resources are accepted once.
 * Membership rows stay in the excluded list. Frozen client charges are rejected.
 */
export function planInfrastructureImports(rows: InfraRow[], config: InfraPlanConfig) {
  const accepted: PlannedInfraEvent[] = []
  const excluded: { sourceId: string; reason: string }[] = []
  const rejected: { sourceId: string; reason: string }[] = []
  const seen = new Set<string>()
  const databaseIdentities = new Set<string>()
  for (const row of rows) {
    if (row.frozenClientCharge) {
      rejected.push({ sourceId: row.sourceId, reason: 'Frozen client charges are not provider expenses' })
      continue
    }
    if (row.periodEnd <= row.periodStart) {
      rejected.push({ sourceId: row.sourceId, reason: 'Exclusive period end must be later than the start' })
      continue
    }
    const identity = `${row.provider}:${row.accountRef}:${row.sourceId}`
    if (seen.has(identity)) {
      rejected.push({ sourceId: row.sourceId, reason: 'Duplicate source identity' })
      continue
    }
    if (row.sourceId.startsWith('vercel:membership:')) {
      excluded.push({ sourceId: row.sourceId, reason: `Fixed daily Vercel allocation is disabled by ${COMPARISON_POLICY_VERSION}` })
      continue
    }
    const database = Boolean(row.resourceRef && config.databaseResourceIds.includes(row.resourceRef))
    if (row.provider === 'supabase' && database) {
      rejected.push({ sourceId: row.sourceId, reason: 'Vercel-billed database cost must be imported once through the Vercel source' })
      continue
    }
    const projects = projectsFor(row, config)
    const attribution = projects.length > 1 ? 'conflict' : projects.length === 1 ? 'mapped' : 'unassigned'
    const billingIdentity = database ? `vercel-database:${row.resourceRef}` : identity
    if (database && databaseIdentities.has(billingIdentity)) {
      rejected.push({ sourceId: row.sourceId, reason: 'Vercel-billed database cost must be imported once through the Vercel source' })
      continue
    }
    seen.add(identity)
    if (database) databaseIdentities.add(billingIdentity)
    accepted.push({
      provider: database ? 'vercel' : row.provider,
      accountRef: row.accountRef,
      sourceKey: row.sourceId,
      billingIdentity,
      projectId: projects.length === 1 ? projects[0] : null,
      attribution,
      category: database ? 'DATABASE' : row.provider === 'vercel' ? 'VERCEL_HOSTING' : 'OTHER',
      billedAmount: row.billedAmount,
      currency: row.currency,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      serviceName: row.serviceName,
    })
  }
  return { accepted, excluded, rejected }
}
