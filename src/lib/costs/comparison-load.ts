import { prisma } from '@/lib/db'
import { LEDGER_START, type StoredPolicyRecord } from './comparison-policy'
import { projectComparison, type ComparisonEvent } from './comparison-snapshot'
import { fetchReferenceRates } from './fx'
import { referenceYears, type FxQuote } from './fx-values'
import type { SettlementDocuments } from './four-views'
import type { AllocationEvent } from './subscription-allocation'

function storedPolicy(policy: { id: string; scopeKey: string; effectiveAt: Date; effectiveUntil: Date | null; billable: boolean; includedBaseBps: number; markupBps: number; infrastructureMarkupBps: number; vercelDailyPence: number }, projectSlug: string | null): StoredPolicyRecord {
  return { id: policy.id, scopeKey: policy.scopeKey, projectSlug, effectiveAt: policy.effectiveAt.toISOString(), effectiveUntil: policy.effectiveUntil?.toISOString() ?? null, billable: policy.billable, includedBaseBps: policy.includedBaseBps, markupBps: policy.markupBps, infrastructureMarkupBps: policy.infrastructureMarkupBps, vercelDailyPence: policy.vercelDailyPence }
}

function toEvent(event: { id: string; provider: string; accountRef: string; sourceKey: string; occurredAt: Date; projectId: string | null; attribution: string; revisions: { funding: string; nominalUnits: bigint | null; providerUnits: bigint | null; currency: string; quality: string; fxGbp: { toString(): string } | null; evidence: unknown }[] }): ComparisonEvent {
  const revision = event.revisions[0]
  const evidence = revision?.evidence
  const covered = Boolean(evidence && typeof evidence === 'object' && !Array.isArray(evidence) && 'coveredByProviderInvoice' in evidence && evidence.coveredByProviderInvoice === true)
  const rate = revision?.fxGbp?.toString() ?? null
  return {
    id: event.id, provider: event.provider, accountRef: event.accountRef, sourceKey: event.sourceKey, occurredAt: event.occurredAt, projectId: event.projectId,
    funding: revision?.funding ?? 'unknown', nominalUnits: revision?.nominalUnits ?? null, providerUnits: revision?.providerUnits ?? null, currency: revision?.currency ?? 'unknown',
    quality: revision?.quality ?? 'missing', attribution: event.attribution, hold: revision ? null : 'Missing revision', coveredByProviderInvoice: covered,
    fx: rate ? { rate, date: event.occurredAt.toISOString().slice(0, 10), source: 'Rate recorded with usage import' } : null,
  }
}

/** Read a project comparison. Reference rates are quoted, not written back onto usage rows. */
export async function loadProjectComparison(slug: string, from: string, subscriptionText: string | null) {
  const project = await prisma.costProject.findUnique({ where: { slug }, include: { policies: true, client: { include: { costPolicies: true } } } })
  if (!project || project.archived) throw new Error('Project not found')
  const occurredAt = { gte: new Date(from) }
  const projectEvents = await prisma.costUsageEvent.findMany({ where: { projectId: project.id, occurredAt }, include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } }, orderBy: { id: 'asc' }, take: 50001 })
  if (projectEvents.length > 50000) throw new Error('Complete project history exceeds comparison limit')
  const accounts = Array.from(new Map(projectEvents.map(event => [`${event.provider}:${event.accountRef}`, { provider: event.provider, accountRef: event.accountRef }])).values())
  const unassigned = accounts.length ? await prisma.costUsageEvent.findMany({ where: { projectId: null, occurredAt, OR: accounts }, include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } }, orderBy: { id: 'asc' }, take: 50001 }) : []
  if (unassigned.length > 50000) throw new Error('Unassigned history exceeds comparison limit')
  const allocationRows = subscriptionText === null || !accounts.length ? [] : await prisma.costUsageEvent.findMany({ where: { provider: 'cursor', occurredAt, OR: accounts.map(account => ({ provider: account.provider, accountRef: account.accountRef })) }, include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } }, take: 50001 })
  if (allocationRows.length > 50000) throw new Error('Subscription window exceeds comparison limit')
  const associations = await prisma.invoiceCostAssociation.findMany({ where: { projectId: project.id }, include: { invoice: { include: { payments: true, creditNotes: true } } } })
  let customerPaymentPence = 0, customerCreditPence = 0, vatPence = 0
  const seen = new Set<string>()
  for (const association of associations) {
    if (seen.has(association.invoiceId)) continue
    seen.add(association.invoiceId)
    vatPence += association.invoice.vatTotal
    for (const payment of association.invoice.payments) customerPaymentPence += payment.isRefund ? -payment.amount : payment.amount
    for (const note of association.invoice.creditNotes) customerCreditPence += note.total
  }
  const documents: SettlementDocuments = {
    providerInvoicePence: null, providerCreditPence: null, prepaidPence: null,
    customerPaymentPence: associations.length ? customerPaymentPence : null,
    customerCreditPence: associations.length ? customerCreditPence : null,
    vatPence: associations.length ? vatPence : null,
  }
  const snapshots = await prisma.costChargeSnapshot.findMany({ where: { projectId: project.id, verificationStatus: 'approved' }, select: { id: true, replacesSnapshotId: true, clientChargePence: true } })
  const replaced = new Set(snapshots.flatMap(row => row.replacesSnapshotId ? [row.replacesSnapshotId] : []))
  const current = snapshots.filter(row => !replaced.has(row.id))
  const approvedClientChargePence = current.length ? current.reduce((total, row) => total + row.clientChargePence, 0) : null
  const policies = [...project.policies.map(policy => storedPolicy(policy, project.slug)), ...(project.client?.costPolicies ?? []).map(policy => storedPolicy(policy, null))]
  const latestImport = accounts.length ? await prisma.costImportRun.findFirst({ where: { OR: accounts }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }) : null
  const allocationEvents: AllocationEvent[] = allocationRows.flatMap(event => {
    const revision = event.revisions[0]
    return revision ? [{ projectId: event.projectId, funding: revision.funding, nominalUnits: revision.nominalUnits, providerUnits: revision.providerUnits, quality: revision.quality, currency: revision.currency }] : []
  })
  const compared = [...projectEvents, ...unassigned].map(toEvent)
  const storedRates = await prisma.costFxRate.findMany({ select: { currency: true, date: true, gbpRate: true, source: true } })
  const referenceQuotes: FxQuote[] = storedRates.map(rate => ({ currency: rate.currency, date: rate.date.toISOString().slice(0, 10), rate: rate.gbpRate.toString(), source: rate.source }))
  const revisionRates = compared.filter(event => event.fx).length
  const missingFx = compared.filter(event => !event.fx && event.currency !== 'GBP')
  for (const year of referenceYears(missingFx.map(event => event.occurredAt))) {
    try { referenceQuotes.push(...await fetchReferenceRates(year)) } catch { /* A failed reference year leaves those rows unresolved. */ }
  }
  const comparison = projectComparison({
    project: slug, asOf: new Date(), from, events: compared, sourceUpdatedAt: latestImport?.createdAt.toISOString() ?? null,
    storedPolicies: policies, documents, approvedClientChargePence, subscriptionInvoicePence: subscriptionText === null ? null : Number(subscriptionText), allocationEvents,
    referenceQuotes,
  })
  return { comparison, fx: { storedTableRates: storedRates.length, revisionRates, missingBeforeReference: missingFx.length } }
}
