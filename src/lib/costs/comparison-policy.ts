import type { Policy } from './money'

/** Shared iTrader ledger boundary. Comparison never starts earlier than this instant. */
export const LEDGER_START = '2026-08-13T23:00:00.000Z'
/**
 * Wire contract for deployed strict iTrader readers. The value and object shape stay mpdee-comparison-policy-v1.
 * Client charge amounts follow CHARGE_RULE_VERSION in money.ts. This constant does not version that calculation.
 */
export const COMPARISON_POLICY_VERSION = 'mpdee-comparison-policy-v1'
export const ALLOCATION_METHOD = 'mpdee-subscription-allocation-v1'

/** Client-pricing policy for the shadow comparison. It does not replace stored CostPolicy rows. */
export const COMPARISON_POLICY = {
  version: COMPARISON_POLICY_VERSION,
  billable: true,
  includedBaseBps: 5000,
  markupBps: 0,
  infrastructureMarkupBps: 0,
  vercelDailyPence: 0,
} as const satisfies Policy & { version: string; vercelDailyPence: number }

/** Prisma field defaults. Billable stays false until a project or client policy is saved. */
export const CODE_POLICY_DEFAULTS = {
  billable: false,
  includedBaseBps: 5000,
  markupBps: 0,
  infrastructureMarkupBps: 0,
  vercelDailyPence: 0,
} as const

/**
 * Known-project setup still writes this iTrader row when that effective date is absent.
 * Recorded rates are 50 percent included, no markup, no infrastructure markup and no daily membership.
 * Those stored fields do not override CHARGE_RULE_VERSION.
 */
export const ITRADER_KNOWN_PROJECT_SEED = {
  slug: 'itrader',
  effectiveAt: '2026-08-01T00:00:00.000Z',
  billable: true,
  includedBaseBps: 5000,
  markupBps: 0,
  infrastructureMarkupBps: 0,
  vercelDailyPence: 0,
} as const

export type StoredPolicyRecord = {
  id: string
  scopeKey: string
  projectSlug: string | null
  effectiveAt: string
  effectiveUntil: string | null
  billable: boolean
  includedBaseBps: number
  markupBps: number
  infrastructureMarkupBps: number
  vercelDailyPence: number
}

/** Three layers: code defaults, the known-project seed, and stored rows when a caller has read them. */
export function policyInventory(stored: StoredPolicyRecord[] | null) {
  return {
    comparison: COMPARISON_POLICY,
    codeDefaults: CODE_POLICY_DEFAULTS,
    knownProjectSeed: ITRADER_KNOWN_PROJECT_SEED,
    storedPolicies: stored,
    storedPoliciesRead: stored !== null,
    unreadReason: stored === null ? 'Live policy rows were not read.' : null,
  }
}

/** Identical checksums add no revision. A changed checksum appends one; it does not rewrite the previous row. */
export function revisionOutcome(previousChecksum: string | null, nextChecksum: string) {
  if (previousChecksum === nextChecksum) return { added: 0, revised: 0, duplicate: 1 }
  if (previousChecksum) return { added: 0, revised: 1, duplicate: 0 }
  return { added: 1, revised: 0, duplicate: 0 }
}
