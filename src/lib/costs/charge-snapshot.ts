import { createHash } from 'node:crypto'

export type ChargeSnapshotInput = {
  projectId: string
  policyVersion: string
  allocationMethod: string | null
  sourceRevisionIds: string[]
  currency: string
  fxSource: string | null
  fxDate: string | null
  fxRate: string | null
  usageValueUnits: string | null
  providerCostUnits: string | null
  clientChargePence: number
  outstandingPence: number | null
  invoiceId: string | null
  paymentId: string | null
  replacesSnapshotId: string | null
  evidence: Record<string, string | number | boolean | null>
}

/** Freeze an approved charge. The same inputs replay to the same id and must not be updated. */
export function freezeChargeSnapshot(input: ChargeSnapshotInput) {
  if (!input.projectId || !input.policyVersion) throw new Error('Approved charge snapshot requires a project and policy version')
  if (!input.sourceRevisionIds.length) throw new Error('Approved charge snapshot requires source revisions')
  if (!Number.isInteger(input.clientChargePence)) throw new Error('Client charge must be integer pence')
  if (input.outstandingPence !== null && !Number.isInteger(input.outstandingPence)) throw new Error('Outstanding balance must be integer pence')
  const sourceRevisionIds = input.sourceRevisionIds.slice().sort()
  const body = { ...input, sourceRevisionIds, verificationStatus: 'approved' as const }
  const id = createHash('sha256').update(JSON.stringify(body)).digest('hex')
  return { id, ...body }
}

export function replayChargeSnapshot(existingIds: readonly string[], next: { id: string }) {
  return { added: existingIds.includes(next.id) ? 0 : 1 }
}

/** A correction is a new snapshot that names the approved row it adjusts. */
export function adjustChargeSnapshot(previousId: string, input: ChargeSnapshotInput) {
  if (!previousId || input.replacesSnapshotId !== previousId) throw new Error('Adjustments must name the snapshot they replace')
  return freezeChargeSnapshot(input)
}
