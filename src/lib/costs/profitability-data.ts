import { prisma } from '@/lib/db'
import { andVisibleInvoice } from '@/lib/invoice-visibility'
import { invoiceCosts } from './profitability'

export async function getInvoiceCostData() {
  const [associations, allocations, expenseTotals] = await Promise.all([
    prisma.invoiceCostAssociation.findMany({ where: { invoice: andVisibleInvoice({ status: { notIn: ['draft', 'cancelled'] } }) }, include: { invoice: { include: { creditNotes: true } } } }),
    prisma.costExpenseAllocation.findMany({ where: { expense: { isArchived: false } } }),
    prisma.expense.aggregate({ where: { isArchived: false }, _sum: { netAmount: true }, _count: true }),
  ])
  const eligible = associations.map(a => ({ id: a.invoiceId, projectId: a.projectId, periodStart: a.periodStart, periodEnd: a.periodEnd, weightPence: a.invoice.total - a.invoice.vatTotal, netPence: a.invoice.total - a.invoice.vatTotal - a.invoice.creditNotes.filter(c => !['draft','cancelled','void'].includes(c.status)).reduce((n,c)=>n+c.total-c.vatTotal,0) }))
  // A refund can offset an unrelated unallocated bill, so compare per expense, not only the net sum.
  const grouped = await prisma.expense.findMany({ where: { isArchived: false }, select: { id: true, netAmount: true, costAllocations: { select: { amountPence: true } } } })
  const invalidExpenseIds = new Set(grouped.filter(e => {
    const sum = e.costAllocations.reduce((n,a)=>n+a.amountPence,0)
    return Math.abs(sum) > Math.abs(e.netAmount) || e.costAllocations.some(a => a.amountPence !== 0 && Math.sign(a.amountPence) !== Math.sign(e.netAmount))
  }).map(e=>e.id))
  const validAllocations = allocations.filter(a=>!invalidExpenseIds.has(a.expenseId))
  const result = invoiceCosts(eligible, validAllocations)
  const allocationSum = validAllocations.reduce((n,a)=>n+a.amountPence,0)
  const unallocatedCount = grouped.filter(e => invalidExpenseIds.has(e.id) || e.netAmount !== e.costAllocations.reduce((n,a)=>n+a.amountPence,0)).length
  return { ...result, associations, allocations: validAllocations, invalidAllocationCount: invalidExpenseIds.size, unallocatedCount, unallocatedPence: (expenseTotals._sum.netAmount || 0) - allocationSum }
}
