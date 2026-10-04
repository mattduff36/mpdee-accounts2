import { validAllocation } from './profitability'

export function previewAllocation(input: { grossPence: number; otherPence: number; amountPence: number }) {
  const applies = validAllocation(input.grossPence, input.amountPence, input.otherPence) && input.amountPence !== 0
  const allocatedPence = applies ? input.otherPence + input.amountPence : input.otherPence
  return {
    applies,
    allocatedPence,
    remainingPence: input.grossPence - allocatedPence,
    approvesCharge: false,
    suppressesUsage: false,
    effect: applies
      ? 'The original expense stays in the book. This share is counted once on the project and the remainder stays overhead.'
      : 'The share was not applied. Allocations must match the expense sign and cannot exceed the remaining amount.',
  }
}
