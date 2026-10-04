import { COMPARISON_POLICY, COMPARISON_POLICY_VERSION, LEDGER_START } from './comparison-policy'
import { eventViews } from './four-views'
import { quoteFor, type FxQuote } from './fx-values'
import { coversDate } from './project-matrix'
import { chargeUnits, decimalUnits, roundRatio, unitsText, UNIT, type Policy } from './money'

export const COMPARISON_CHARGE_LABEL = 'Provisional iTrader comparison charge'
export const STORED_POLICY_LABEL = 'Stored policy client estimate'

export type EstimateEvent = {
  provider: string
  accountRef: string
  sourceKey: string
  occurredAt: string
  revision: number
  revisionAt?: string | null
  funding: string
  nominalUnits: bigint | null
  providerUnits: bigint | null
  currency: string
  quality: string
  attribution: string
  resourceRef?: string | null
  recordedFx?: string | null
  coveredByProviderInvoice?: boolean
  provenance?: 'live' | 'local-shadow'
}

export type RatePolicy = Policy & {
  scope: 'project' | 'client'
  effectiveAt: string
  effectiveUntil: string | null
  vercelDailyPence: number
}

export type NativeAmount = { currency: string; units: bigint; rows: number }

export type GbpSlice = {
  pence: number | null
  partial: boolean
  estimate: boolean
  fxMissingRows: number
  recordedRateRows: number
  referenceRateRows: number
}

export type PricedComponent = {
  rows: number
  nativeCharge: NativeAmount[]
  nativeBasis: NativeAmount[]
  gbp: GbpSlice
  firstAt: string | null
  lastAt: string | null
  provenance: 'absent' | 'live' | 'local-shadow'
}

export type ExclusionBucket = {
  key: string
  label: string
  rows: number
  nominal: NativeAmount[]
  recordedProvider: NativeAmount[]
  reason: string
}

export type ProvisionalEstimate = {
  policyVersion: typeof COMPARISON_POLICY_VERSION
  ledgerStart: string
  asOf: string
  firstAt: string | null
  lastAt: string | null
  latestRevisionAt: string | null
  included: PricedComponent
  onDemand: PricedComponent
  infrastructure: PricedComponent
  comparison: {
    label: typeof COMPARISON_CHARGE_LABEL
    nativeCharge: NativeAmount[]
    gbp: GbpSlice
    infrastructureIncluded: boolean
    duplicateRevisions: number
    coveredByProviderInvoiceRows: number
  }
  exclusions: ExclusionBucket[]
  storedPolicy: {
    label: typeof STORED_POLICY_LABEL
    rows: number
    uncoveredRows: number
    nativeCharge: NativeAmount[]
    gbp: GbpSlice
    rates: { includedBaseBps: number; markupBps: number; infrastructureMarkupBps: number; vercelDailyPence: number; billable: boolean }[]
    dailyMembershipApplied: false
  } | null
}

type DayAcc = { numerator: bigint; estimate: boolean; recordedRows: number; referenceRows: number }
type MoneyAcc = { nativeCharge: Map<string, NativeAmount>; nativeBasis: Map<string, NativeAmount>; days: Map<string, DayAcc>; rows: number; fxMissing: number; firstAt: string | null; lastAt: string | null; provenance: Set<string> }

const emptyGbp = (): GbpSlice => ({ pence: null, partial: false, estimate: false, fxMissingRows: 0, recordedRateRows: 0, referenceRateRows: 0 })

const exclusionCopy: Record<string, { label: string; reason: string }> = {
  'unknown-funding': { label: 'Unknown funding', reason: 'Unresolved funding is excluded. It is not labelled as free credit.' },
  'free-credit': { label: 'Free-credit funding', reason: 'Free-credit funding stays separate from unknown funding and is excluded from the comparison charge.' },
  'free-funding': { label: 'Funding marked free', reason: 'A provider free label is excluded from the comparison charge.' },
  held: { label: 'Held for review', reason: 'Incomplete quality, missing amounts, or an unexpected category stay out of the charge.' },
  'not-attributed': { label: 'Not explicitly attributed', reason: 'Unassigned and conflicting rows stay out of the iTrader charge.' },
  'before-ledger': { label: 'Before the ledger boundary', reason: 'Events before 2026-08-13T23:00:00.000Z are outside this charge.' },
  membership: { label: 'Daily membership rows', reason: 'vercel:membership rows are excluded. The comparison adds no daily membership fee.' },
  'database-already-billed': { label: 'Database already in Vercel billing', reason: 'A database resource already present on a Vercel row is not charged again.' },
  'unreadable-time': { label: 'Unreadable event time', reason: 'The stored clock could not be read as UTC digits.' },
}

/** One stored usage row, using the latest revision the caller already selected. */
export function estimateEvent(input: {
  provider: string
  accountRef: string
  sourceKey: string
  occurredClock: string
  revision: number
  revisionClock?: string | null
  funding: string
  nominalUnits: bigint | null
  providerUnits: bigint | null
  currency: string
  quality: string
  attribution: string
  resourceRef?: string | null
  recordedFx?: string | null
  coveredByProviderInvoice?: boolean
  provenance?: EstimateEvent['provenance']
}): EstimateEvent {
  return {
    provider: input.provider,
    accountRef: input.accountRef,
    sourceKey: input.sourceKey,
    occurredAt: storedClockToIso(input.occurredClock),
    revision: input.revision,
    revisionAt: input.revisionClock ? storedClockToIso(input.revisionClock) : null,
    funding: input.funding,
    nominalUnits: input.nominalUnits,
    providerUnits: input.providerUnits,
    currency: input.currency,
    quality: input.quality,
    attribution: input.attribution,
    resourceRef: input.resourceRef,
    recordedFx: input.recordedFx,
    coveredByProviderInvoice: input.coveredByProviderInvoice,
    provenance: input.provenance,
  }
}

/** Stored timestamp-without-time-zone digits, read with a Z suffix and no hour shift. */
export function storedClockToIso(clock: string) {
  const match = clock.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/)
  if (!match) throw new Error('Unreadable stored clock')
  return `${match[1]}T${match[2]}.${(match[3] ?? '').padEnd(3, '0')}Z`
}

function eventInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function addNative(map: Map<string, NativeAmount>, currency: string, units: bigint) {
  const current = map.get(currency) ?? { currency, units: BigInt(0), rows: 0 }
  current.units += units
  current.rows += 1
  map.set(currency, current)
}

function listNative(map: Map<string, NativeAmount>) {
  return Array.from(map.values()).sort((a, b) => a.currency.localeCompare(b.currency))
}

function emptyAcc(): MoneyAcc {
  return { nativeCharge: new Map(), nativeBasis: new Map(), days: new Map(), rows: 0, fxMissing: 0, firstAt: null, lastAt: null, provenance: new Set() }
}

function finishGbp(acc: MoneyAcc): GbpSlice {
  if (!acc.rows) return emptyGbp()
  let pence = BigInt(0)
  let estimate = false
  let recorded = 0
  let reference = 0
  for (const day of acc.days.values()) {
    pence += roundRatio(day.numerator * BigInt(100), UNIT * BigInt(100_000_000))
    if (day.estimate) estimate = true
    recorded += day.recordedRows
    reference += day.referenceRows
  }
  if (!acc.days.size) return { pence: null, partial: true, estimate: false, fxMissingRows: acc.fxMissing, recordedRateRows: 0, referenceRateRows: 0 }
  if (pence > BigInt(Number.MAX_SAFE_INTEGER) || pence < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('Comparison amount exceeds safe integer range')
  return { pence: Number(pence), partial: acc.fxMissing > 0, estimate, fxMissingRows: acc.fxMissing, recordedRateRows: recorded, referenceRateRows: reference }
}

function finishComponent(acc: MoneyAcc): PricedComponent {
  const provenance = acc.provenance.has('local-shadow') ? 'local-shadow' : acc.rows ? 'live' : 'absent'
  return { rows: acc.rows, nativeCharge: listNative(acc.nativeCharge), nativeBasis: listNative(acc.nativeBasis), gbp: finishGbp(acc), firstAt: acc.firstAt, lastAt: acc.lastAt, provenance }
}

function resolveFx(event: EstimateEvent, quotes: FxQuote[]) {
  const day = event.occurredAt.slice(0, 10)
  if (event.currency === 'GBP') return { rate: '1', date: day, source: 'GBP original amount', estimate: false }
  if (event.recordedFx && Number(event.recordedFx) > 0) return { rate: event.recordedFx, date: day, source: 'Rate recorded with usage import', estimate: false }
  const quote = quoteFor(quotes, event.currency, day)
  if (!quote) return null
  return { rate: quote.rate, date: quote.date, source: quote.source, estimate: true }
}

function policyOn(policies: RatePolicy[], occurredAt: string) {
  const day = new Date(occurredAt)
  const pick = (scope: RatePolicy['scope']) => {
    const peers = policies.filter(policy => policy.scope === scope).map(policy => ({ ...policy, effectiveAt: new Date(policy.effectiveAt), effectiveUntil: policy.effectiveUntil ? new Date(policy.effectiveUntil) : null }))
    return peers.filter(policy => coversDate(policy, peers, day)).sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime())[0] ?? null
  }
  return pick('project') ?? pick('client')
}

function addExclusion(map: Map<string, ExclusionBucket>, key: string, event: EstimateEvent | null) {
  const copy = exclusionCopy[key] ?? { label: key, reason: 'Excluded from the comparison charge.' }
  const current = map.get(key) ?? { key, label: copy.label, rows: 0, nominal: [], recordedProvider: [], reason: copy.reason }
  if (!event) { map.set(key, current); return }
  current.rows += 1
  const nominal = new Map(current.nominal.map(item => [item.currency, { ...item }]))
  const recorded = new Map(current.recordedProvider.map(item => [item.currency, { ...item }]))
  if (event.nominalUnits !== null) addNative(nominal, event.currency, event.nominalUnits)
  if (event.providerUnits !== null) addNative(recorded, event.currency, event.providerUnits)
  current.nominal = listNative(nominal)
  current.recordedProvider = listNative(recorded)
  map.set(key, current)
}

function classify(event: EstimateEvent, vercelResources: Set<string>) {
  if (eventInstant(event.occurredAt) === null) return 'unreadable-time'
  if (event.occurredAt < LEDGER_START) return 'before-ledger'
  if (event.sourceKey.startsWith('vercel:membership:')) return 'membership'
  if (event.attribution !== 'mapped' && event.attribution !== 'manual') return 'not-attributed'
  if (event.provider === 'supabase' && event.resourceRef && vercelResources.has(event.resourceRef)) return 'database-already-billed'
  if (event.funding === 'unknown') return 'unknown-funding'
  if (event.funding === 'free-credit') return 'free-credit'
  if (event.funding === 'free') return 'free-funding'
  if (event.quality !== 'complete') return 'held'
  if (event.provider === 'cursor' && event.funding === 'included') return 'included'
  if (event.provider === 'cursor' && event.funding === 'on-demand') return 'on-demand'
  if ((event.provider === 'vercel' || event.provider === 'supabase' || event.provider === 'manual') && event.funding === 'infrastructure') return 'infrastructure'
  return 'held'
}

function price(acc: MoneyAcc, event: EstimateEvent, charge: bigint, basis: bigint | null, fx: ReturnType<typeof resolveFx>) {
  acc.rows += 1
  acc.provenance.add(event.provenance ?? 'live')
  if (!acc.firstAt || event.occurredAt < acc.firstAt) acc.firstAt = event.occurredAt
  if (!acc.lastAt || event.occurredAt > acc.lastAt) acc.lastAt = event.occurredAt
  addNative(acc.nativeCharge, event.currency, charge)
  if (basis !== null) addNative(acc.nativeBasis, event.currency, basis)
  if (!fx) { acc.fxMissing += 1; return }
  const day = acc.days.get(event.occurredAt.slice(0, 10)) ?? { numerator: BigInt(0), estimate: false, recordedRows: 0, referenceRows: 0 }
  day.numerator += charge * decimalUnits(fx.rate, 8)
  if (fx.estimate) { day.estimate = true; day.referenceRows += 1 } else day.recordedRows += 1
  acc.days.set(event.occurredAt.slice(0, 10), day)
}

function combineGbp(parts: GbpSlice[], active: boolean[]): GbpSlice {
  let pence = 0
  let any = false
  let partial = false
  let estimate = false
  let fxMissing = 0
  let recorded = 0
  let reference = 0
  parts.forEach((part, index) => {
    if (!active[index]) return
    fxMissing += part.fxMissingRows
    recorded += part.recordedRateRows
    reference += part.referenceRateRows
    if (part.pence === null) { partial = true; return }
    any = true
    pence += part.pence
    if (part.partial) partial = true
    if (part.estimate) estimate = true
  })
  if (!any) return { pence: null, partial, estimate, fxMissingRows: fxMissing, recordedRateRows: recorded, referenceRateRows: reference }
  return { pence, partial, estimate, fxMissingRows: fxMissing, recordedRateRows: recorded, referenceRateRows: reference }
}

function combineNative(parts: NativeAmount[][]) {
  const map = new Map<string, NativeAmount>()
  for (const list of parts) for (const item of list) {
    const current = map.get(item.currency) ?? { currency: item.currency, units: BigInt(0), rows: 0 }
    current.units += item.units
    current.rows += item.rows
    map.set(item.currency, current)
  }
  return listNative(map)
}

/**
 * Provisional comparison charge from latest event rows.
 * Included Cursor is 50% of nominal, on-demand is provider cash, infrastructure is face value.
 * Stored policy rates, invoices, payments and daily membership are not added to that charge.
 */
export function provisionalComparisonEstimate(input: {
  asOf: string
  events: EstimateEvent[]
  referenceQuotes?: FxQuote[]
  storedPolicies?: RatePolicy[]
  extraExclusions?: ExclusionBucket[]
}): ProvisionalEstimate {
  const quotes = input.referenceQuotes ?? []
  const byIdentity = new Map<string, EstimateEvent>()
  let duplicateRevisions = 0
  for (const event of input.events) {
    const key = `${event.provider}:${event.accountRef}:${event.sourceKey}`
    const current = byIdentity.get(key)
    if (!current || event.revision > current.revision) {
      if (current) duplicateRevisions += 1
      byIdentity.set(key, event)
    } else duplicateRevisions += 1
  }
  const kept = Array.from(byIdentity.values())
  const vercelResources = new Set(kept.flatMap(event => event.provider === 'vercel' && event.resourceRef ? [event.resourceRef] : []))
  const exclusions = new Map<string, ExclusionBucket>()
  for (const key of ['unknown-funding', 'free-credit', 'held']) addExclusion(exclusions, key, null)
  const included = emptyAcc()
  const onDemand = emptyAcc()
  const infrastructure = emptyAcc()
  const storedIncluded = emptyAcc()
  const storedOnDemand = emptyAcc()
  const storedInfrastructure = emptyAcc()
  const storedRates: NonNullable<ProvisionalEstimate['storedPolicy']>['rates'] = []
  let uncoveredRows = 0
  let firstAt: string | null = null
  let lastAt: string | null = null
  let latestRevisionAt: string | null = null
  let coveredByProviderInvoiceRows = 0
  for (const event of kept) {
    const instant = eventInstant(event.occurredAt)
    if (instant !== null && event.occurredAt >= LEDGER_START) {
      if (!firstAt || event.occurredAt < firstAt) firstAt = event.occurredAt
      if (!lastAt || event.occurredAt > lastAt) lastAt = event.occurredAt
    }
    if (event.revisionAt && (!latestRevisionAt || event.revisionAt > latestRevisionAt)) latestRevisionAt = event.revisionAt
    const kind = classify(event, vercelResources)
    if (kind !== 'included' && kind !== 'on-demand' && kind !== 'infrastructure') {
      addExclusion(exclusions, kind, event)
      continue
    }
    const fx = resolveFx(event, quotes)
    const views = eventViews({
      id: `${event.provider}:${event.accountRef}:${event.sourceKey}`,
      provider: event.provider,
      funding: event.funding,
      nominalUnits: event.nominalUnits,
      providerUnits: event.providerUnits,
      currency: event.currency,
      quality: event.quality,
      attribution: event.attribution,
      hold: null,
      coveredByProviderInvoice: Boolean(event.coveredByProviderInvoice),
      fx: fx ? { rate: fx.rate, date: fx.date, source: fx.source } : null,
    }, COMPARISON_POLICY)
    if (views.clientCharge === null) {
      addExclusion(exclusions, 'held', event)
      continue
    }
    if (event.coveredByProviderInvoice) coveredByProviderInvoiceRows += 1
    const basis = kind === 'included' ? event.nominalUnits : event.providerUnits
    const acc = kind === 'included' ? included : kind === 'on-demand' ? onDemand : infrastructure
    price(acc, event, views.clientCharge, basis, fx)
    const policy = policyOn(input.storedPolicies ?? [], event.occurredAt)
    if (!policy?.billable) { uncoveredRows += 1; continue }
    const storedCharge = chargeUnits({ provider: event.provider, funding: event.funding, nominal: event.nominalUnits, cash: event.providerUnits }, policy)
    if (storedCharge === null) { uncoveredRows += 1; continue }
    const storedAcc = kind === 'included' ? storedIncluded : kind === 'on-demand' ? storedOnDemand : storedInfrastructure
    price(storedAcc, event, storedCharge, basis, fx)
    if (!storedRates.some(rate => rate.includedBaseBps === policy.includedBaseBps && rate.markupBps === policy.markupBps && rate.infrastructureMarkupBps === policy.infrastructureMarkupBps && rate.vercelDailyPence === policy.vercelDailyPence && rate.billable === policy.billable)) {
      storedRates.push({ includedBaseBps: policy.includedBaseBps, markupBps: policy.markupBps, infrastructureMarkupBps: policy.infrastructureMarkupBps, vercelDailyPence: policy.vercelDailyPence, billable: policy.billable })
    }
  }
  const includedComponent = finishComponent(included)
  const onDemandComponent = finishComponent(onDemand)
  const infrastructureComponent = finishComponent(infrastructure)
  const active = [includedComponent.rows > 0, onDemandComponent.rows > 0, infrastructureComponent.rows > 0]
  for (const extra of input.extraExclusions ?? []) exclusions.set(extra.key, extra)
  return {
    policyVersion: COMPARISON_POLICY_VERSION,
    ledgerStart: LEDGER_START,
    asOf: input.asOf,
    firstAt,
    lastAt,
    latestRevisionAt,
    included: includedComponent,
    onDemand: onDemandComponent,
    infrastructure: infrastructureComponent,
    comparison: {
      label: COMPARISON_CHARGE_LABEL,
      nativeCharge: combineNative([includedComponent, onDemandComponent, infrastructureComponent].filter((_, index) => active[index]).map(component => component.nativeCharge)),
      gbp: combineGbp([includedComponent.gbp, onDemandComponent.gbp, infrastructureComponent.gbp], active),
      infrastructureIncluded: infrastructureComponent.rows > 0,
      duplicateRevisions,
      coveredByProviderInvoiceRows,
    },
    exclusions: Array.from(exclusions.values()),
    storedPolicy: input.storedPolicies ? {
      label: STORED_POLICY_LABEL,
      rows: storedIncluded.rows + storedOnDemand.rows + storedInfrastructure.rows,
      uncoveredRows,
      nativeCharge: combineNative([storedIncluded, storedOnDemand, storedInfrastructure].filter(acc => acc.rows > 0).map(acc => listNative(acc.nativeCharge))),
      gbp: combineGbp([finishGbp(storedIncluded), finishGbp(storedOnDemand), finishGbp(storedInfrastructure)], [storedIncluded.rows > 0, storedOnDemand.rows > 0, storedInfrastructure.rows > 0]),
      rates: storedRates,
      dailyMembershipApplied: false,
    } : null,
  }
}

export function formatNative(amounts: NativeAmount[]) {
  if (!amounts.length) return 'None in this scope'
  return amounts.map(amount => `${amount.currency} ${unitsText(amount.units)}`).join('; ')
}

export function formatGbp(slice: GbpSlice) {
  if (slice.pence === null) return 'Unavailable'
  const pounds = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(slice.pence / 100)
  const notes = [slice.estimate ? 'ECB reference estimate, not bank-settled GBP' : null, slice.partial ? 'partial' : null].filter((note): note is string => Boolean(note))
  return notes.length ? `${pounds} (${notes.join('; ')})` : pounds
}

export type PresentedEstimate = {
  title: string
  headline: string
  note: string
  lines: { label: string; value: string; detail: string }[]
  exclusions: { label: string; value: string; detail: string }[]
  pricing: string[]
  storedPolicy: { label: string; value: string; detail: string } | null
}

function componentLine(label: string, basis: string, component: PricedComponent) {
  const value = component.rows ? `${formatGbp(component.gbp)} · ${formatNative(component.nativeCharge)}` : 'None in this calculation'
  const detail = component.rows
    ? `${component.rows} events. ${basis} ${formatNative(component.nativeBasis)}.${component.firstAt ? ` ${component.firstAt} to ${component.lastAt}.` : ''}`
    : basis
  return { label, value, detail }
}

/** Display copy for the live page and the private supplemental report. */
export function presentProvisionalEstimate(estimate: ProvisionalEstimate, options?: { infrastructureRowsInDatabase?: number }): PresentedEstimate {
  const databaseRows = options?.infrastructureRowsInDatabase
  const infraMissing = estimate.infrastructure.rows === 0
  const infraNote = infraMissing
    ? databaseRows === 0 || databaseRows === undefined
      ? 'Infrastructure is not stored in this database. Missing, not a verified £0.'
      : 'No infrastructure events are attributed to iTrader. Missing from this charge, not a verified £0.'
    : estimate.infrastructure.provenance === 'local-shadow'
      ? 'Infrastructure is local shadow evidence only and is not on the live page. A 07:00 timestamp is the daily bucket, not a collector completion time.'
      : 'Infrastructure is included at face value from this database.'
  const scope = estimate.comparison.infrastructureIncluded ? 'Cursor usage and eligible infrastructure.' : 'Cursor usage only.'
  const gbpNote = estimate.comparison.gbp.pence === null
    ? 'A complete GBP figure is unavailable. Native amounts above are the supported record.'
    : estimate.comparison.gbp.partial
      ? 'The GBP figure is a supported subtotal of the events with a rate.'
      : 'Each event uses the rate for its own day.'
  const exclusionLine = (key: string) => {
    const bucket = estimate.exclusions.find(item => item.key === key)
    const nominal = bucket && bucket.nominal.length ? ` Nominal ${formatNative(bucket.nominal)}.` : ''
    const recorded = bucket && bucket.recordedProvider.length ? ` Recorded provider amount ${formatNative(bucket.recordedProvider)}.` : ''
    return { label: bucket?.label ?? key, value: `${bucket?.rows ?? 0} events.${nominal}${recorded}`, detail: bucket?.reason ?? '' }
  }
  const rates = estimate.storedPolicy?.rates ?? []
  const rateText = rates.length
    ? rates.map(rate => `included ${rate.includedBaseBps / 100}% plus markup ${rate.markupBps / 100} percentage points, on-demand ${100 + rate.markupBps / 100}%, infrastructure ${100 + rate.infrastructureMarkupBps / 100}%, saved daily rate £${(rate.vercelDailyPence / 100).toFixed(2)}`).join('; ')
    : 'No covering stored rate priced these events.'
  return {
    title: COMPARISON_CHARGE_LABEL,
    headline: formatGbp(estimate.comparison.gbp),
    note: `${scope} ${infraNote} ${gbpNote}`,
    lines: [
      { label: 'Ledger start', value: estimate.ledgerStart, detail: 'Events before this instant are outside the charge.' },
      { label: 'Event range', value: estimate.firstAt && estimate.lastAt ? `${estimate.firstAt} to ${estimate.lastAt}` : 'No events in this database', detail: 'Stored clocks are UTC digits. No hour was added for BST.' },
      { label: 'Observed', value: estimate.asOf, detail: estimate.latestRevisionAt ? `Latest stored revision clock ${estimate.latestRevisionAt}.` : 'No revision clock was stored on these rows.' },
      componentLine('Included Cursor usage', '50% of nominal', estimate.included),
      componentLine('On-demand Cursor', '100% of recorded provider cash', estimate.onDemand),
      estimate.infrastructure.rows
        ? componentLine('Infrastructure', estimate.infrastructure.provenance === 'local-shadow' ? 'Face value, local shadow only.' : 'Face value from this database.', estimate.infrastructure)
        : { label: 'Infrastructure', value: 'Missing', detail: infraNote },
    ],
    exclusions: [
      exclusionLine('unknown-funding'),
      exclusionLine('free-credit'),
      exclusionLine('held'),
      ...estimate.exclusions.filter(bucket => !['unknown-funding', 'free-credit', 'held'].includes(bucket.key) && bucket.rows > 0).map(bucket => exclusionLine(bucket.key)),
    ],
    pricing: [
      `${estimate.policyVersion}. Included Cursor is 50% of nominal usage. On-demand Cursor is 100% of recorded provider cash. Eligible infrastructure is face value.`,
      'No markup. No daily membership allocation.',
      'Zero per-event cash on included usage is not a free subscription.',
      'GBP conversion uses a dated rate for each event. A rate recorded on the event takes precedence. Reference rates are estimates, not bank-settled GBP. Missing rates stay unavailable.',
      'Subscription invoices, allocated expenses, payments and credits are not added to this charge. Approved outstanding is separate.',
      estimate.comparison.coveredByProviderInvoiceRows
        ? `${estimate.comparison.coveredByProviderInvoiceRows} events are marked covered by a provider invoice. That invoice is not added again.`
        : 'No event in this charge is marked covered by a provider invoice.',
      estimate.comparison.duplicateRevisions ? `${estimate.comparison.duplicateRevisions} older revisions were not counted again.` : 'Older revisions were not counted again.',
    ],
    storedPolicy: estimate.storedPolicy ? {
      label: STORED_POLICY_LABEL,
      value: estimate.storedPolicy.rows ? formatGbp(estimate.storedPolicy.gbp) : 'No stored rate was applied',
      detail: `${rateText} The saved daily rate is not applied. ${estimate.storedPolicy.uncoveredRows} comparison events had no billable stored rate. This amount is separate from the comparison charge. Native ${formatNative(estimate.storedPolicy.nativeCharge)}.`,
    } : null,
  }
}
