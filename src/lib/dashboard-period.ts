export function monthRange(reference: Date): { gte: Date; lt: Date } {
  return {
    gte: new Date(reference.getFullYear(), reference.getMonth(), 1),
    lt: new Date(reference.getFullYear(), reference.getMonth() + 1, 1),
  }
}

export function netAfterExpenses(paidInvoicePence: number, expensePence: number): number {
  return paidInvoicePence - expensePence
}
