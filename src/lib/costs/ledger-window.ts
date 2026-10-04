import { LEDGER_START } from './comparison-policy'

/** Book dates are timestamp-without-time-zone clock digits. Compare them as UTC. */
export function bookTimeInLedger(booked: string, ledgerStart = LEDGER_START) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(booked)) throw new Error('Unreadable expense date')
  return `${booked.replace(' ', 'T')}Z` >= ledgerStart
}
