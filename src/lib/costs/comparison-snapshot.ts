import { createHash } from 'node:crypto'
import { type CalculationRates, type HostingSchedule } from './calculation-settings'
import { type DailyHostingFee } from './daily-hosting'
import { CHARGE_RULE_VERSION, UNIT, unitsText, type Policy } from './money'
import { resolvePolicy, type DatedPolicy } from './service'
import { quoteFor, type FxQuote } from './fx-values'
import { ALLOCATION_METHOD, COMPARISON_POLICY, COMPARISON_POLICY_VERSION, LEDGER_START, policyInventory, type StoredPolicyRecord } from './comparison-policy'
import { eventViews, outstandingBalance, type MoneyEvent, type SettlementDocuments } from './four-views'
import { allocateSubscriptionExpense, type AllocationEvent } from './subscription-allocation'

export type ComparisonEvent = MoneyEvent & {
  provider: string
  accountRef: string
  sourceKey: string
  occurredAt: Date
  projectId: string | null
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item)).digest('hex')
const categoryFor = (provider: string) => provider === 'cursor' ? 'CURSOR' : provider === 'vercel' ? 'VERCEL_HOSTING' : provider === 'supabase' ? 'DATABASE' : 'OTHER'
const text = (value: bigint | null) => value === null ? null : unitsText(value)

function penceNumber(value: bigint | null) {
  if (value === null) return null
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('Comparison amount exceeds safe integer range')
  return Number(value)
}

type Total = {
  usage: bigint
  provider: bigint
  charge: bigint
  knownUsage: boolean
  knownProvider: boolean
  knownCharge: boolean
  unresolvedUsage: number
  unresolvedProvider: number
  unresolvedCharge: number
  fxEstimate: number
}
const emptyTotal = (): Total => ({ usage: BigInt(0), provider: BigInt(0), charge: BigInt(0), knownUsage: false, knownProvider: false, knownCharge: false, unresolvedUsage: 0, unresolvedProvider: 0, unresolvedCharge: 0, fxEstimate: 0 })

function pricedComparisonPolicy(rates: CalculationRates | undefined, billable = true): Policy {
  const policy: Policy = rates
    ? { billable: true, includedBaseBps: COMPARISON_POLICY.includedBaseBps, markupBps: COMPARISON_POLICY.markupBps, infrastructureMarkupBps: COMPARISON_POLICY.infrastructureMarkupBps, rates }
    : COMPARISON_POLICY
  return billable ? policy : { ...policy, billable: false }
}

/** Project slug matches a project policy. A null slug is the client policy (projectId null). Other projects are ignored. */
function datedStoredPolicies(records: StoredPolicyRecord[], project: string): DatedPolicy[] {
  const dated: DatedPolicy[] = []
  for (const record of records) {
    const projectPolicy = record.projectSlug === project
    const clientPolicy = record.projectSlug === null
    if (!projectPolicy && !clientPolicy) continue
    dated.push({
      id: record.id,
      projectId: projectPolicy ? project : null,
      clientId: clientPolicy ? 'client' : null,
      effectiveAt: new Date(record.effectiveAt),
      effectiveUntil: record.effectiveUntil ? new Date(record.effectiveUntil) : null,
      billable: record.billable,
      includedBaseBps: record.includedBaseBps,
      markupBps: record.markupBps,
      infrastructureMarkupBps: record.infrastructureMarkupBps,
    })
  }
  return dated
}

/** Project-scoped shadow comparison. Source currencies are totalled separately and are not forced to match another ledger. */
export function projectComparison(input: {
  project: string
  asOf: Date
  from?: string | null
  events: ComparisonEvent[]
  sourceUpdatedAt: string | null
  storedPolicies: StoredPolicyRecord[] | null
  documents: SettlementDocuments
  approvedClientChargePence: number | null
  subscriptionInvoicePence?: number | null
  allocationEvents?: AllocationEvent[]
  referenceQuotes?: FxQuote[]
  rates?: CalculationRates
  hostingFees?: DailyHostingFee[]
  hostingSchedule?: HostingSchedule
  globalRevision?: string | null
  projectRevision?: string | null
}) {
  const from = input.from ?? LEDGER_START
  if (from < LEDGER_START) throw new Error('Comparison cannot start before the shared ledger boundary')
  if (input.events.length > 50000) throw new Error('Comparison exceeds 50000 events')
  const fromTime = Date.parse(from)
  const asOfTime = input.asOf.getTime()
  const events = input.events.filter(event => {
    const time = event.occurredAt.getTime()
    return time >= fromTime && time <= asOfTime
  }).sort((a, b) => a.id.localeCompare(b.id))
  const defaultPolicy = pricedComparisonPolicy(input.rates)
  const datedPolicies = input.storedPolicies === null ? null : datedStoredPolicies(input.storedPolicies, input.project)
  let held = 0, fxMissing = 0, unassigned = 0, zeroProviderCashIncluded = 0
  let unassignedAndHeld = 0, heldAndFx = 0, unionUnresolved = 0
  const totals = new Map<string, Total>()
  const lines = events.map(event => {
    const day = event.occurredAt.toISOString().slice(0, 10)
    const storedFx = event.fx ?? (event.currency === 'GBP' ? { rate: '1', date: day, source: 'GBP original amount' } : null)
    const reference = storedFx ? null : quoteFor(input.referenceQuotes ?? [], event.currency, day)
    const estimate = Boolean(reference)
    const fx = storedFx ?? (reference ? { rate: reference.rate, date: reference.date, source: reference.source } : null)
    const fxQuote = fx ? { currency: event.currency, date: fx.date, rate: fx.rate, source: fx.source, estimate } : null
    const dated = datedPolicies && event.projectId ? resolvePolicy(datedPolicies, input.project, 'client', event.occurredAt) : null
    const hold = datedPolicies && event.projectId && !dated ? (event.hold ?? 'No effective charging policy') : event.hold
    const policy = dated ? pricedComparisonPolicy(input.rates, dated.billable) : defaultPolicy
    const views = eventViews({ ...event, hold, fx }, policy)
    const rowHeld = Boolean(views.reason && views.clientCharge === null)
    const rowFxMissing = views.clientCharge !== null && views.clientChargePence === null
    const rowUnassigned = event.attribution === 'unassigned' || event.attribution === 'conflict'
    if (rowHeld) held++
    if (rowFxMissing) fxMissing++
    if (rowUnassigned) unassigned++
    if (rowUnassigned && rowHeld) unassignedAndHeld++
    if (rowHeld && rowFxMissing) heldAndFx++
    if (rowHeld || rowFxMissing || estimate) unionUnresolved++
    if (views.includedCashIsNotSubscription) zeroProviderCashIncluded++
    const currency = event.currency || 'unknown'
    const total = totals.get(currency) ?? emptyTotal()
    if (event.provider === 'cursor') {
      if (views.usageValue === null) total.unresolvedUsage += 1
      else { total.usage += views.usageValue; total.knownUsage = true }
    }
    const providerApplies = !(event.provider === 'cursor' && event.funding === 'included') && !event.coveredByProviderInvoice
    if (providerApplies) {
      if (views.providerCost === null) total.unresolvedProvider += 1
      else { total.provider += views.providerCost; total.knownProvider = true }
    }
    if (views.clientCharge === null) total.unresolvedCharge += 1
    else { total.charge += views.clientCharge; total.knownCharge = true }
    if (estimate) total.fxEstimate += 1
    totals.set(currency, total)
    const proof = { id: event.id, model: event.model ?? null, chargeRule: CHARGE_RULE_VERSION, views, fx: fxQuote }
    return {
      id: hash([input.project, event.provider, event.accountRef, event.sourceKey]),
      revision: hash(proof),
      category: categoryFor(event.provider) as 'CURSOR' | 'VERCEL_HOSTING' | 'DATABASE' | 'OTHER',
      funding: event.funding,
      currency,
      periodStart: day,
      periodEnd: day,
      held: views.clientCharge === null,
      provisional: true as const,
      invoiceability: 'PROVISIONAL' as const,
      reason: views.reason,
      events: 1,
      usageValue: text(views.usageValue),
      providerCost: text(views.providerCost),
      clientCharge: text(views.clientCharge),
      clientChargePence: penceNumber(views.clientChargePence),
      fx: fxQuote ? [fxQuote] : [],
    }
  })
  for (const fee of input.hostingFees ?? []) {
    const units = BigInt(fee.amountPence) * UNIT / BigInt(100)
    const currency = 'GBP'
    const total = totals.get(currency) ?? emptyTotal()
    total.charge += units
    total.knownCharge = true
    totals.set(currency, total)
    const proof = { id: fee.id, chargeRule: CHARGE_RULE_VERSION, rates: input.rates ?? null, configRevision: fee.configRevision, amountPence: fee.amountPence, providerCash: false }
    lines.push({
      id: hash([input.project, fee.id]),
      revision: hash(proof),
      category: 'VERCEL_HOSTING',
      funding: 'infrastructure',
      currency,
      periodStart: fee.date,
      periodEnd: fee.date,
      held: false,
      provisional: true as const,
      invoiceability: 'PROVISIONAL' as const,
      reason: fee.label,
      events: 0,
      usageValue: null,
      providerCost: null,
      clientCharge: text(units),
      clientChargePence: penceNumber(BigInt(fee.amountPence)),
      fx: [],
    })
  }
  const outstanding = outstandingBalance({ approvedClientChargePence: input.approvedClientChargePence, documents: input.documents })
  const subscriptionAllocation = input.subscriptionInvoicePence == null
    ? null
    : allocateSubscriptionExpense(input.subscriptionInvoicePence, input.allocationEvents ?? [])
  const coverage = {
    events: events.length, held, fxMissing, unassigned, from,
    overlap: { unassignedAndHeld, heldAndFx, unionUnresolved, note: 'Unassigned rows are included in held. Do not add unassigned, held and missing-FX counts.' },
  }
  const body = {
    version: 'mpdee-project-cost-comparison-v1' as const,
    project: input.project,
    policyVersion: COMPARISON_POLICY_VERSION,
    allocationMethod: ALLOCATION_METHOD,
    approvedSnapshot: false as const,
    authoritativeWriter: 'itrader' as const,
    ledgerStart: LEDGER_START,
    asOf: input.asOf.toISOString(),
    sourceUpdatedAt: input.sourceUpdatedAt,
    reconciliation: {
      status: 'shadow' as const,
      unresolved: unionUnresolved,
      note: 'iTrader remains the writer. Source totals are not forced to agree. Known subtotals exclude unresolved rows and are not a complete balance.',
    },
    coverage,
    totals: Array.from(totals, ([currency, total]) => ({
      currency,
      usageValue: total.knownUsage ? unitsText(total.usage) : null,
      providerCost: total.knownProvider ? unitsText(total.provider) : null,
      clientCharge: total.knownCharge ? unitsText(total.charge) : null,
      complete: total.unresolvedUsage === 0 && total.unresolvedProvider === 0 && total.unresolvedCharge === 0 && total.fxEstimate === 0,
      unresolved: { usageEvents: total.unresolvedUsage, providerEvents: total.unresolvedProvider, chargeEvents: total.unresolvedCharge, fxEstimateEvents: total.fxEstimate },
    })).sort((a, b) => a.currency.localeCompare(b.currency)),
    outstanding: { pence: outstanding.outstandingPence, reason: outstanding.reason },
    documents: input.documents,
    lines,
    subscriptionAllocation,
    zeroProviderCashIncluded,
    policyInventory: policyInventory(input.storedPolicies),
  }
  const revisionProof = { project: input.project, chargeRule: CHARGE_RULE_VERSION, lines, coverage, outstanding: body.outstanding, documents: input.documents }
  const calculation = input.rates || input.hostingFees ? {
    rates: input.rates ?? null,
    globalRevision: input.globalRevision ?? null,
    projectRevision: input.projectRevision ?? null,
    hostingSchedule: input.hostingSchedule ?? null,
    hostingConfigRevisions: Array.from(new Set((input.hostingFees ?? []).map(fee => fee.configRevision))).sort(),
  } : null
  return { ...body, revision: hash(calculation ? { ...revisionProof, calculation } : revisionProof) }
}
