import { LEDGER_START } from './comparison-policy'

export const NAIVE_PREVIOUS_START = '2026-09-01 07:00:00'
export const HOUR_MS = 3_600_000

export type DifferenceKind =
  | 'missing-events'
  | 'duplicates'
  | 'attribution'
  | 'funding'
  | 'policy'
  | 'fx'
  | 'rounding'
  | 'infrastructure-coverage'
  | 'adjustments'
  | 'settlements'

export type SourceAmount = {
  id: string
  currency: string
  units: bigint
  projectId: string | null
  funding: string
  provider: string
  view: 'usage-value' | 'provider-cost' | 'client-charge'
}

/** Compare source-currency amounts. Equal totals are reported; they are not required. */
export function explainSourceDelta(accounts: SourceAmount[], itrader: SourceAmount[]) {
  const differences: { kind: DifferenceKind; id: string; detail: string }[] = []
  const count = (rows: SourceAmount[]) => {
    const seen = new Map<string, number>()
    for (const row of rows) seen.set(row.id, (seen.get(row.id) ?? 0) + 1)
    for (const [id, copies] of Array.from(seen)) {
      if (copies > 1) differences.push({ kind: 'duplicates', id, detail: `${copies} copies share one source identity` })
    }
    return seen
  }
  const left = count(accounts)
  const right = count(itrader)
  const leftById = new Map(accounts.map(row => [row.id, row]))
  const rightById = new Map(itrader.map(row => [row.id, row]))
  for (const [id, row] of Array.from(leftById)) {
    const other = rightById.get(id)
    if (!other || !right.has(id)) {
      differences.push({ kind: 'missing-events', id, detail: 'Present in Accounts only' })
      continue
    }
    if (row.projectId !== other.projectId) differences.push({ kind: 'attribution', id, detail: 'Project attribution differs' })
    if (row.funding !== other.funding) differences.push({ kind: 'funding', id, detail: 'Funding differs' })
    if (row.currency !== other.currency) differences.push({ kind: 'fx', id, detail: 'Source currency differs' })
    if (row.provider !== other.provider) differences.push({ kind: 'infrastructure-coverage', id, detail: 'Provider source differs' })
    if (row.units !== other.units) {
      const kind = row.view === 'client-charge' ? 'policy' : row.view === 'provider-cost' ? 'rounding' : 'adjustments'
      differences.push({ kind, id, detail: 'Source units differ before FX and pence rounding' })
    }
  }
  for (const id of Array.from(rightById.keys())) {
    if (!left.has(id)) differences.push({ kind: 'missing-events', id, detail: 'Present in iTrader only' })
  }
  const currencies = Array.from(new Set([...accounts, ...itrader].map(row => row.currency))).sort()
  const sum = (rows: SourceAmount[], currency: string) => rows.filter(row => row.currency === currency).reduce((total, row) => total + row.units, BigInt(0))
  return {
    differences,
    totals: currencies.map(currency => {
      const accountsUnits = sum(accounts, currency)
      const itraderUnits = sum(itrader, currency)
      return { currency, accounts: accountsUnits.toString(), itrader: itraderUnits.toString(), equal: accountsUnits === itraderUnits }
    }),
    forcedAgreement: false as const,
  }
}

export type HistoricalSource = {
  id: string
  label: string
  amountPence: number
  source: 'payment' | 'credit-note' | 'legacy-client-charge' | 'provider-usage' | 'provider-invoice'
  periodStart: string
  periodEnd: string
  invoiceId: string | null
  paymentId: string | null
  settlementId: string | null
}

export type HistoricalClass = {
  id: string
  treatment: 'customer-payment' | 'client-charge-credit' | 'client-charge-adjustment' | 'unresolved'
  amountPence: number | null
  countsAsProviderExpense: boolean
  settlementLinked: boolean
  periodEnd: string | null
}

function linked(record: HistoricalSource) {
  return Boolean(record.invoiceId || record.paymentId || record.settlementId)
}

/** Classify a supplied source row. Missing reported items stay unresolved instead of being invented. */
export function classifyReportedRecords(records: HistoricalSource[]): HistoricalClass[] {
  const specs: { treatment: HistoricalClass['treatment']; match: (record: HistoricalSource) => boolean }[] = [
    { treatment: 'customer-payment', match: record => record.amountPence > 0 && record.source === 'payment' && /payment/i.test(record.label) },
    { treatment: 'client-charge-credit', match: record => record.amountPence < 0 && record.source === 'legacy-client-charge' },
    { treatment: 'client-charge-adjustment', match: record => record.amountPence > 0 && record.source === 'legacy-client-charge' },
  ]
  return specs.map(spec => {
    const found = records.find(spec.match)
    if (!found) return { id: '', treatment: 'unresolved' as const, amountPence: null, countsAsProviderExpense: false, settlementLinked: false, periodEnd: null }
    if (found.periodEnd <= found.periodStart) throw new Error('Exclusive period end must be later than the start')
    return {
      id: found.id,
      treatment: spec.treatment,
      amountPence: found.amountPence,
      countsAsProviderExpense: false,
      settlementLinked: linked(found),
      periodEnd: found.periodEnd,
    }
  })
}

/** Report a one-hour offset from the ledger boundary without moving the stored instant. */
export function baselineTimestamp(instant: string) {
  const start = Date.parse(LEDGER_START)
  const value = Date.parse(instant)
  if (!Number.isFinite(value)) throw new Error('Invalid timestamp')
  const offsetMs = value - start
  return {
    instant: new Date(value).toISOString(),
    ledgerStart: LEDGER_START,
    naivePreviousStart: NAIVE_PREVIOUS_START,
    offsetMs,
    oneHourDiscrepancy: Math.abs(offsetMs) === HOUR_MS,
    matchesLedgerStart: offsetMs === 0,
  }
}

export type LedgerCharge = {
  id: string
  kind: 'CHARGE' | 'REVERSAL'
  amountPence: number
  reversesId: string | null
}

/** Net the current charges after applying reversals. A reversed charge is not deducted again. */
export function netReversalChain(charges: LedgerCharge[]) {
  const reversed = new Set(charges.filter(charge => charge.kind === 'REVERSAL' && charge.reversesId).map(charge => charge.reversesId as string))
  const current = charges.filter(charge => charge.kind === 'CHARGE' && !reversed.has(charge.id))
  return {
    netPence: current.reduce((total, charge) => total + charge.amountPence, 0),
    currentIds: current.map(charge => charge.id),
    reversedIds: Array.from(reversed),
  }
}

/** A same-client invoice does not link the payment to the project, and the ledger credit is kept once. */
export function reviewInvoiceCredit(input: {
  chain: LedgerCharge[]
  invoice: { amountPence: number; sameClient: boolean; projectLinked: boolean } | null
}) {
  const net = netReversalChain(input.chain)
  const projectLinked = Boolean(input.invoice?.projectLinked)
  return {
    netPence: net.netPence,
    countedOnce: net.currentIds.length === 1,
    deductPayment: false,
    projectLinked,
    sameClientIsNotLinkage: Boolean(input.invoice?.sameClient && !projectLinked),
  }
}

/** A client-charge adjustment stays unresolved until evidence shows whether it duplicates usage. */
export function reviewClientAdjustment(input: { amountPence: number; usageEvidence: 'unknown' | 'established-duplicate' | 'established-distinct' }) {
  if (input.usageEvidence === 'unknown') return { status: 'unresolved' as const, amountPence: input.amountPence, countsAsDuplicate: false }
  return { status: 'reviewed' as const, amountPence: input.amountPence, countsAsDuplicate: input.usageEvidence === 'established-duplicate' }
}

/** A clock reading without a zone is not enough evidence to move a stored timestamp. */
export function refuseNaiveTimezoneCorrection(raw: string) {
  return { raw, correction: null, reason: 'A timestamp without a time zone is not evidence of a one-hour error.' }
}

/** Convert a naive Europe/London local timestamp to UTC. The input text is not rewritten. */
export function londonLocalToUtc(naive: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(naive)
  if (!match) throw new Error('Naive timestamp must be YYYY-MM-DD HH:mm:ss')
  const [, year, month, day, hour, minute, second] = match
  const guess = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)))
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess).map(part => [part.type, part.value]))
  const zonedHour = parts.hour === '24' ? 0 : Number(parts.hour)
  const zonedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), zonedHour, Number(parts.minute), Number(parts.second))
  return new Date(guess.getTime() - (zonedAsUtc - guess.getTime()))
}
