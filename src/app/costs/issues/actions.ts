'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireWrite } from '@/lib/auth'
import { previewAllocation } from '@/lib/costs/allocation-preview'
import { parsePeriod } from '@/lib/costs/profitability'
import { prisma } from '@/lib/db'

const text = (form: FormData, key: string) => String(form.get(key) || '').trim()

export async function reviewIssue(form: FormData) {
  await requireWrite()
  const user = await requireAuth()
  const stableKey = text(form, 'stableKey')
  const status = text(form, 'status')
  const note = text(form, 'note')
  if (!/^[a-z0-9-]{3,80}$/.test(stableKey)) throw new Error('Unknown issue')
  if (!['open', 'reviewed', 'resolved'].includes(status)) throw new Error('Choose a status')
  if (note.length < 3 || note.length > 2000) throw new Error('Add a review note')
  const issue = await prisma.costReconciliationIssue.update({ where: { stableKey }, data: { status, resolutionNote: note } })
  await prisma.costReconciliationEvent.create({ data: { issueId: issue.id, action: 'status', note, actorEmail: user.email } })
  await prisma.auditLog.create({ data: { userId: user.id, action: 'cost_issue_status', entityType: 'CostReconciliationIssue', entityId: issue.id, details: JSON.stringify({ status, note }) } })
  revalidatePath('/costs/issues')
}

export async function saveBillMetadata(form: FormData) {
  await requireWrite()
  const user = await requireAuth()
  const expenseId = text(form, 'expenseId')
  const accountRef = text(form, 'accountRef')
  const serviceName = text(form, 'serviceName')
  const start = text(form, 'periodStart')
  const end = text(form, 'periodEnd')
  if (accountRef && !/^[a-zA-Z0-9_-]{3,100}$/.test(accountRef)) throw new Error('Account reference must be a short token, not an email address')
  if (serviceName && !['subscription', 'on-demand', 'infrastructure', 'membership'].includes(serviceName)) throw new Error('Choose a service')
  const period = start || end ? parsePeriod(start, end) : null
  const expense = await prisma.expense.findFirst({ where: { id: expenseId, isArchived: false } })
  if (!expense) throw new Error('Expense not found')
  await prisma.expense.update({
    where: { id: expense.id },
    data: { providerAccountRef: accountRef || null, serviceName: serviceName || null, billingPeriodStart: period?.periodStart ?? null, billingPeriodEnd: period?.periodEnd ?? null },
  })
  await prisma.auditLog.create({ data: { userId: user.id, action: 'cost_bill_metadata', entityType: 'Expense', entityId: expense.id, details: JSON.stringify({ accountRef: accountRef || null, serviceName: serviceName || null, periodStart: start || null, periodEnd: end || null }) } })
  revalidatePath('/costs/issues')
}

export async function applyExpenseShare(form: FormData) {
  await requireWrite()
  const user = await requireAuth()
  const expenseId = text(form, 'expenseId')
  const projectId = text(form, 'projectId')
  const raw = text(form, 'amount')
  const note = text(form, 'note')
  const confirmed = text(form, 'confirm')
  if (confirmed !== 'apply') throw new Error('Preview the share, then confirm it')
  if (!/^-?\d{1,8}(\.\d{1,2})?$/.test(raw)) throw new Error('Enter a GBP amount')
  if (note.length < 3 || note.length > 1000) throw new Error('Add an explanation')
  const amountPence = Math.round(Number(raw) * 100)
  const period = parsePeriod(text(form, 'periodStart'), text(form, 'periodEnd'))
  const expense = await prisma.expense.findFirst({ where: { id: expenseId, isArchived: false }, include: { costAllocations: true } })
  const project = await prisma.costProject.findFirst({ where: { id: projectId, archived: false } })
  if (!expense || !project) throw new Error('Choose an expense and a project')
  if (!expense.providerAccountRef || !expense.serviceName || !expense.billingPeriodStart || !expense.billingPeriodEnd) throw new Error('Record the provider account, service and billing period before allocating')
  const other = expense.costAllocations.filter(share => share.projectId !== project.id).reduce((total, share) => total + share.amountPence, 0)
  const preview = previewAllocation({ grossPence: expense.grossAmount, otherPence: other, amountPence })
  if (!preview.applies) throw new Error(preview.effect)
  await prisma.costExpenseAllocation.upsert({
    where: { expenseId_projectId: { expenseId: expense.id, projectId: project.id } },
    create: { expenseId: expense.id, projectId: project.id, amountPence, kind: 'direct', ...period, note },
    update: { amountPence, ...period, note },
  })
  await prisma.auditLog.create({ data: { userId: user.id, action: 'cost_expense_allocation', entityType: 'Expense', entityId: expense.id, details: JSON.stringify({ projectId: project.id, amountPence, remainingPence: preview.remainingPence, approvesCharge: preview.approvesCharge }) } })
  revalidatePath('/costs/issues')
  revalidatePath('/costs')
}
