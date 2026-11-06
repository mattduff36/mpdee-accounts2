type AllocatedRecord = {
  currency: string
  buckets: {
    projectId: string | null
    project: { id: string; name: string; slug: string } | null
    amountMinor: number
    gbpEstimatePence: number | null
  }[]
}

/** Sum only subdivisions, never source amounts plus subdivisions; currencies stay separate. */
export function summarizeManualAllocations(records: AllocatedRecord[]) {
  const totals = new Map<string, {
    projectId: string | null; project: AllocatedRecord['buckets'][number]['project']
    currency: string; amountMinor: number; gbpEstimatePence: number | null; missingGbpEstimates: number
  }>()
  for (const record of records) for (const bucket of record.buckets) {
    const key = JSON.stringify([record.currency, bucket.projectId])
    const total = totals.get(key) ?? {
      projectId: bucket.projectId, project: bucket.project, currency: record.currency,
      amountMinor: 0, gbpEstimatePence: 0, missingGbpEstimates: 0,
    }
    total.amountMinor += bucket.amountMinor
    if (!Number.isSafeInteger(total.amountMinor)) throw new Error('Allocation report exceeds safe integer range')
    if (bucket.gbpEstimatePence === null) {
      total.missingGbpEstimates++
      total.gbpEstimatePence = null
    } else if (total.gbpEstimatePence !== null) {
      total.gbpEstimatePence += bucket.gbpEstimatePence
      if (!Number.isSafeInteger(total.gbpEstimatePence)) throw new Error('GBP allocation report exceeds safe integer range')
    }
    totals.set(key, total)
  }
  return [...totals.values()]
}
