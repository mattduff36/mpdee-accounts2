import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { monthRange, netAfterExpenses } from "./dashboard-period"

describe("dashboard month summary", () => {
  it("uses one half-open local calendar-month range for receipts and expenses", () => {
    const range = monthRange(new Date(2026, 1, 28, 23, 59, 59))
    assert.deepEqual(range, { gte: new Date(2026, 1, 1), lt: new Date(2026, 2, 1) })
    assert.equal(range.gte < range.lt, true)
  })

  it("subtracts expenses from paid invoice totals for that same month", () => {
    assert.equal(netAfterExpenses(150_00, 72_45), 77_55)
    assert.equal(netAfterExpenses(0, 1), -1)
  })
})
