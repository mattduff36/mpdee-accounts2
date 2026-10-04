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

export function unresolvedCoverageText(bill: { reference: string; grossPence: number; booked: string; sourceDate: string | null }) {
  const pounds = (bill.grossPence / 100).toFixed(2)
  const source = bill.sourceDate
    ? `The accounts-book notes record a source date of ${bill.sourceDate} and a bank settlement.`
    : 'The accounts-book notes do not record a source date.'
  return `${bill.reference} is GBP ${pounds}, booked at ${bill.booked}. ${source} There is no receipt, invoice link, or service period. The booking time is why the ledger filter omits it. A service period is still required before this amount can enter or leave the ledger total.`
}
