import { unitsText } from './money'

type LedgerRow = {
  event: { occurredAt: Date; provider: string; model: string | null }
  revision: { funding: string; nominalUnits: bigint | null; providerUnits: bigint | null; currency: string; quality: string } | undefined
  hold: string | null
  charge: bigint | null
}

export function projectLedgerResponse(month: string, projectSlug: string, rows: LedgerRow[]) {
  const totals = new Map<string, { events: number; nominal: bigint; providerCost: bigint; estimatedCharge: bigint; nominalEvents: number; providerCostEvents: number; chargeEvents: number }>()
  const safeRows = rows.map(({ event, revision, hold, charge }) => {
    const currency = revision?.currency ?? null
    if (currency) {
      const total = totals.get(currency) ?? { events: 0, nominal: BigInt(0), providerCost: BigInt(0), estimatedCharge: BigInt(0), nominalEvents: 0, providerCostEvents: 0, chargeEvents: 0 }
      total.events++
      if (revision?.nominalUnits !== null && revision?.nominalUnits !== undefined) { total.nominal += revision.nominalUnits; total.nominalEvents++ }
      if (revision?.providerUnits !== null && revision?.providerUnits !== undefined) { total.providerCost += revision.providerUnits; total.providerCostEvents++ }
      if (charge !== null) { total.estimatedCharge += charge; total.chargeEvents++ }
      totals.set(currency, total)
    }
    return {
      occurredAt: event.occurredAt.toISOString(),
      provider: event.provider,
      model: event.model,
      funding: revision?.funding ?? null,
      nominal: revision?.nominalUnits == null ? null : unitsText(revision.nominalUnits),
      providerCost: revision?.providerUnits == null ? null : unitsText(revision.providerUnits),
      estimatedCharge: charge === null ? null : unitsText(charge),
      currency,
      quality: revision?.quality ?? 'missing',
      hold: hold ? 'review-required' : null,
    }
  })
  return {
    version: 'mpdee-project-cost-ledger-v1',
    month,
    project: projectSlug,
    status: 'provisional-estimates',
    approvedSnapshot: false,
    rows: safeRows,
    totals: Array.from(totals.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([currency, total]) => ({
      currency,
      events: total.events,
      nominal: total.nominalEvents ? unitsText(total.nominal) : null,
      providerCost: total.providerCostEvents ? unitsText(total.providerCost) : null,
      estimatedCharge: total.chargeEvents ? unitsText(total.estimatedCharge) : null,
    })),
  }
}
