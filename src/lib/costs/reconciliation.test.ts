import assert from 'node:assert/strict'
import { test } from 'node:test'
import { liveIssueDrafts, mergeIssue, recordedIssueDrafts, type IssueDraft } from './reconciliation'
import type { CostSummary } from './figures'
import { previewAllocation } from './allocation-preview'

const summary = (patch: Partial<CostSummary> = {}): CostSummary => ({
  projects: [], unassignedInfrastructureRows: 838, unassignedInfrastructure: [{ currency: 'USD', units: BigInt(25_806_452), rows: 838, missing: 0 }],
  unassignedCursorRows: 10, freeCreditRows: 70, freeCredit: [{ currency: 'USD', units: BigInt(53_840_327), rows: 70, missing: 0 }],
  missingNominalRows: 29, providerBills: 25, providerBillPence: 159885, unallocatedBillPence: 159885, unresolvedBills: [], usageRowsWithStoredFx: 0, ...patch,
})

test('review status is kept and does not change money', () => {
  const draft = liveIssueDrafts(summary())[0]
  const merged = mergeIssue({ stableKey: draft.stableKey, status: 'resolved', resolutionNote: 'Checked' }, draft)
  assert.equal(merged.status, 'resolved')
  assert.equal(merged.resolutionNote, 'Checked')
  assert.equal(merged.changesMoney, false)
  assert.equal(merged.amountText?.includes('2.5806452'), true)
})

test('live bill and infrastructure counts come from the summary', () => {
  const issues = liveIssueDrafts(summary({ providerBills: 3, providerBillPence: 100, unassignedInfrastructureRows: 4 }))
  assert.equal(issues.find(issue => issue.id === 'provider-bills')?.description.startsWith('3 provider'), true)
  assert.equal(issues.find(issue => issue.id === 'unassigned-infrastructure')?.description.startsWith('4 imported'), true)
  assert.equal(issues.find(issue => issue.id === 'fx-limits')?.description.startsWith('0 usage'), true)
})

test('recorded conflicts explain overlap and do not choose a source', () => {
  const funding = recordedIssueDrafts().find(issue => issue.id === 'funding-conflicts') as IssueDraft
  const material = recordedIssueDrafts().find(issue => issue.id === 'material-amounts') as IssueDraft
  const text = JSON.stringify(recordedIssueDrafts())
  assert.equal(/[0-9a-f]{12}/.test(text), false)
  assert.match(funding.description, /Do not add the two lists/)
  assert.match(material.description, /Neither source is selected/)
  assert.equal(material.amountUnknown, true)
})

test('an unresolved provider bill stays outside the ledger bill count', () => {
  const issues = liveIssueDrafts(summary({
    providerBills: 2,
    providerBillPence: 200,
    unresolvedBills: [{ reference: 'provider-bill', grossPence: 100, booked: '2026-08-13 00:00:00', sourceDate: '2026-08-12' }],
  }))
  const coverage = issues.find(issue => issue.id === 'unresolved-bill-coverage')
  assert.match(coverage?.description ?? '', /provider-bill/)
  assert.match(coverage?.description ?? '', /2026-08-12/)
  assert.match(coverage?.description ?? '', /service period is still required/)
  assert.equal(coverage?.effectOnTotals.includes('Omitted from the ledger bill total'), true)
  assert.equal(issues.find(issue => issue.id === 'provider-bills')?.description.startsWith('2 provider'), true)
})

test('allocation preview conserves the bill and blocks an over-allocation', () => {
  const preview = previewAllocation({ grossPence: 1000, otherPence: 400, amountPence: 600 })
  assert.equal(preview.applies, true)
  assert.equal(preview.allocatedPence + preview.remainingPence, 1000)
  assert.equal(preview.approvesCharge, false)
  assert.equal(previewAllocation({ grossPence: 1000, otherPence: 400, amountPence: 700 }).applies, false)
})
