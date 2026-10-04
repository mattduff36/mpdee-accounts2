import { chargeUnits, gbpPence, type Policy } from './money'
import { COMPARISON_POLICY } from './comparison-policy'

export type MoneyEvent = {
  id: string
  provider: string
  funding: string
  nominalUnits: bigint | null
  providerUnits: bigint | null
  currency: string
  quality: string
  attribution: string
  hold: string | null
  coveredByProviderInvoice: boolean
  fx: { rate: string; date: string; source: string } | null
}

export type EventViews = {
  usageValue: bigint | null
  providerCost: bigint | null
  clientCharge: bigint | null
  clientChargePence: bigint | null
  includedCashIsNotSubscription: boolean
  reason: string | null
}

function blocked(event: MoneyEvent): string | null {
  if (event.hold) return event.hold
  if (event.quality !== 'complete') return 'Source requires review'
  if (event.funding === 'unknown') return 'Unknown funding'
  if (event.attribution === 'unassigned' || event.attribution === 'conflict') return `Project ${event.attribution}`
  return null
}

/** Usage value, provider cost and client charge stay independent. A held client charge does not blank a known source amount. */
export function eventViews(event: MoneyEvent, policy: Policy = COMPARISON_POLICY): EventViews {
  const includedCashIsNotSubscription = event.provider === 'cursor' && event.funding === 'included' && event.providerUnits === BigInt(0)
  const hold = blocked(event)
  const usageValue = event.provider === 'cursor' ? event.nominalUnits : null
  let providerCost: bigint | null = null
  let note: string | null = hold
  if (event.coveredByProviderInvoice) note = hold ?? 'Covered by a provider invoice; underlying usage is evidence only'
  else if (event.provider === 'cursor' && event.funding === 'included') note = hold ?? 'Included usage cash is not the subscription expense'
  else providerCost = event.providerUnits
  if (hold) return { usageValue, providerCost, clientCharge: null, clientChargePence: null, includedCashIsNotSubscription, reason: note }
  const clientCharge = chargeUnits({
    provider: event.provider,
    funding: event.funding,
    nominal: event.nominalUnits,
    cash: event.providerUnits,
  }, policy)
  let clientChargePence: bigint | null = null
  if (clientCharge === null) note = note ?? 'Client charge is unavailable'
  else if (!event.fx) note = note ?? 'Missing FX'
  else clientChargePence = gbpPence(clientCharge, event.fx.rate)
  return { usageValue, providerCost, clientCharge, clientChargePence, includedCashIsNotSubscription, reason: note }
}

export type SettlementDocuments = {
  providerInvoicePence: number | null
  providerCreditPence: number | null
  customerCreditPence: number | null
  customerPaymentPence: number | null
  vatPence: number | null
  prepaidPence: number | null
}

/** Outstanding uses approved client charges and customer settlements only. Estimates are not a balance. */
export function outstandingBalance(input: {
  approvedClientChargePence: number | null
  documents: SettlementDocuments
}) {
  const { documents } = input
  if (input.approvedClientChargePence === null) {
    return { outstandingPence: null as number | null, reason: 'No approved client charges' }
  }
  let outstanding = input.approvedClientChargePence
  if (documents.customerPaymentPence !== null) outstanding -= documents.customerPaymentPence
  if (documents.customerCreditPence !== null) outstanding -= documents.customerCreditPence
  if (documents.prepaidPence !== null) outstanding -= documents.prepaidPence
  return { outstandingPence: outstanding, reason: null as string | null }
}
