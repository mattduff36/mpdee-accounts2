import { createHash } from 'node:crypto'
import { CHARGE_RULE_VERSION } from './money'
import { presentProvisionalEstimate, type ProvisionalEstimate } from './provisional-estimate'

export type ProjectSummaryExclusion = { key: string; label: string; rows: number; reason: string }

export type ProjectCostSummary = {
  version: 'mpdee-project-cost-summary-v1'
  project: string
  source: 'mpdee-accounts'
  pricingRuleVersion: typeof CHARGE_RULE_VERSION
  ledgerStart: string
  asOf: string
  sourceUpdatedAt: string | null
  revision: string
  approvedSnapshot: false
  currency: 'GBP'
  estimate: {
    totalPence: number | null
    includedPence: number | null
    onDemandPence: number | null
    infrastructurePence: number | null
    partial: boolean
    fxEstimated: boolean
    fxMissingRows: number
  }
  coverage: {
    firstEventAt: string | null
    lastEventAt: string | null
    includedRows: number
    onDemandRows: number
    infrastructureRows: number
    infrastructureStatus: 'absent' | 'live' | 'local-shadow'
    exclusions: ProjectSummaryExclusion[]
  }
  outstanding: { pence: number | null; reason: string | null }
  pricing: string[]
}

function infrastructurePence(estimate: ProvisionalEstimate, status: ProvisionalEstimate['infrastructure']['provenance']): number | null {
  const feePence = estimate.calculation.hostingFeePence
  const actual = status === 'absent' ? null : integerPence(estimate.infrastructure.gbp.pence)
  if (actual === null && status !== 'absent') return null
  if (actual === null && feePence === 0) return null
  const total = (actual ?? 0) + feePence
  return integerPence(total)
}

function integerPence(value: number | null): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Summary amount exceeds safe integer range')
  return value
}

/** Exclusion copy written for one project must not name a different project. */
function publicReason(reason: string, project: string) {
  if (project === 'itrader') return reason
  return reason.replace(/\biTrader\b/g, 'project')
}

/**
 * Public project summary. Pence come from the provisional estimate and the approved outstanding balance.
 * Native source units are omitted so JSON serialization cannot see a BigInt.
 */
export function projectCostSummary(input: {
  project: string
  estimate: ProvisionalEstimate
  comparisonRevision: string
  outstanding: { pence: number | null; reason: string | null }
}): ProjectCostSummary {
  const { estimate } = input
  const infrastructureStatus = estimate.infrastructure.provenance
  const estimateBody = {
    totalPence: integerPence(estimate.comparison.gbp.pence),
    includedPence: integerPence(estimate.included.gbp.pence),
    onDemandPence: integerPence(estimate.onDemand.gbp.pence),
    infrastructurePence: infrastructurePence(estimate, infrastructureStatus),
    partial: estimate.comparison.gbp.partial || infrastructureStatus === 'absent' || estimate.exclusions.some(bucket => bucket.rows > 0 && ['held', 'unknown-funding', 'not-attributed', 'unreadable-time'].includes(bucket.key)),
    fxEstimated: estimate.comparison.gbp.estimate,
    fxMissingRows: estimate.comparison.gbp.fxMissingRows,
  }
  const exclusions = estimate.exclusions.map(bucket => ({
    key: bucket.key,
    label: bucket.label,
    rows: bucket.rows,
    reason: publicReason(bucket.reason, input.project),
  }))
  const coverage = {
    firstEventAt: estimate.firstAt,
    lastEventAt: estimate.lastAt,
    includedRows: estimate.included.rows,
    onDemandRows: estimate.onDemand.rows,
    infrastructureRows: estimate.infrastructure.rows,
    infrastructureStatus,
    exclusions,
  }
  const outstanding = { pence: integerPence(input.outstanding.pence), reason: input.outstanding.reason }
  const pricing = presentProvisionalEstimate(estimate).pricing
  const sourceUpdatedAt = estimate.latestRevisionAt
  const revision = createHash('sha256').update(JSON.stringify({
    project: input.project,
    pricingRuleVersion: CHARGE_RULE_VERSION,
    ledgerStart: estimate.ledgerStart,
    sourceUpdatedAt,
    comparisonRevision: input.comparisonRevision,
    estimate: estimateBody,
    coverage,
    outstanding,
    pricing,
  })).digest('hex')
  return {
    version: 'mpdee-project-cost-summary-v1',
    project: input.project,
    source: 'mpdee-accounts',
    pricingRuleVersion: CHARGE_RULE_VERSION,
    ledgerStart: estimate.ledgerStart,
    asOf: estimate.asOf,
    sourceUpdatedAt,
    revision,
    approvedSnapshot: false,
    currency: 'GBP',
    estimate: estimateBody,
    coverage,
    outstanding,
    pricing,
  }
}
