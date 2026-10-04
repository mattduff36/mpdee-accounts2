import { prisma } from '@/lib/db'
import type { CostSummary } from './figures'
import { liveIssueDrafts, mergeIssue, recordedIssueDrafts, type IssueDraft } from './reconciliation'

/** Refresh issue text from the current ledger. Status and resolution notes are left as reviewed. */
export async function syncReconciliationIssues(summary: CostSummary) {
  const drafts = [...liveIssueDrafts(summary), ...recordedIssueDrafts()]
  const existing = await prisma.costReconciliationIssue.findMany({ select: { stableKey: true, status: true, resolutionNote: true } })
  const byKey = new Map(existing.map(issue => [issue.stableKey, issue]))
  for (const draft of drafts) {
    const merged = mergeIssue(byKey.get(draft.stableKey) ?? null, draft)
    const { id, ...rest } = fields(draft)
    await prisma.costReconciliationIssue.upsert({
      where: { stableKey: draft.stableKey },
      create: { id, ...rest, status: merged.status, resolutionNote: merged.resolutionNote },
      update: rest,
    })
    if (!byKey.has(draft.stableKey)) {
      await prisma.costReconciliationEvent.create({ data: { issueId: draft.id, action: 'opened', note: 'Opened from the current ledger. Status changes do not alter costs.' } })
    }
    void merged
  }
  return drafts.length
}

function fields(draft: IssueDraft) {
  return {
    id: draft.id, stableKey: draft.stableKey, projectSlug: draft.projectSlug, provider: draft.provider, accountRef: draft.accountRef,
    periodStart: draft.periodStart ? new Date(draft.periodStart) : null, periodEnd: draft.periodEnd ? new Date(draft.periodEnd) : null,
    title: draft.title, description: draft.description, evidenceRef: draft.evidenceRef, amountText: draft.amountText, currency: draft.currency,
    amountUnknown: draft.amountUnknown, effectOnTotals: draft.effectOnTotals, billingEffect: draft.billingEffect, requiredAction: draft.requiredAction,
  }
}
