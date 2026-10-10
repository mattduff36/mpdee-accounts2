import { LEDGER_START } from './comparison-policy'

export type BillEvidence = {
  reference: string
  booked: string
  grossPence: number
  sourceDate: string | null
  periodStart: string | null
  periodEnd: string | null
}

export type BillCoverage = {
  treatment: 'overlap' | 'outside-period' | 'unresolved'
  countsInLedger: boolean
  reason: string
}

/** A service period is a start and end. A book time or a single source date is not one. */
export function billCoverage(evidence: BillEvidence): BillCoverage {
  if (evidence.periodStart && evidence.periodEnd) {
    const start = `${evidence.periodStart}T00:00:00.000Z`
    const end = `${evidence.periodEnd}T23:59:59.999Z`
    if (start > end) return { treatment: 'unresolved', countsInLedger: false, reason: 'The recorded period is not usable.' }
    if (end < LEDGER_START) return { treatment: 'outside-period', countsInLedger: false, reason: 'The service period ends before the ledger start.' }
    return { treatment: 'overlap', countsInLedger: true, reason: 'The service period overlaps the ledger.' }
  }
  return { treatment: 'unresolved', countsInLedger: false, reason: 'The booking time and a single source date do not establish a service period.' }
}

export function sourceDateFromNotes(notes: string | null | undefined) {
  return notes?.match(/source date(?: of)? (\d{4}-\d{2}-\d{2})/)?.[1] ?? null
}

/** Compact issue copy. The complete unresolved provider bill list remains available. */
export function unresolvedBillIssueCopy(bills: { reference: string; grossPence: number; booked: string; sourceDate: string | null }[]) {
  if (!bills.length) {
    return {
      title: 'Historical provider bills with unverified service periods',
      description: 'No provider bill is waiting on a service period.',
      amountText: 'Not allocated to client costs',
    }
  }
  const highlighted = bills.slice(0, 3)
  return {
    title: 'Historical provider bills with unverified service periods',
    description: `${bills.length} historical provider bills have unverified service periods. Their GBP accounts-book gross remains outside client estimates until coverage and allocation are established. A service period is still required. ${highlighted.map(bill => unresolvedCoverageText(bill)).join(' ')}`.trim(),
    amountText: 'Not allocated to client costs',
  }
}

export function unresolvedCoverageText(bill: { reference: string; grossPence: number; booked: string; sourceDate: string | null }) {
  const pounds = (bill.grossPence / 100).toFixed(2)
  const source = bill.sourceDate
    ? `The accounts-book notes record a source date of ${bill.sourceDate}.`
    : 'The accounts-book notes do not record a source date.'
  return `${bill.reference} is GBP ${pounds} accounts-book gross, booked at ${bill.booked}. ${source} A service period is still required before this bill can be included in the covered ledger totals.`
}
