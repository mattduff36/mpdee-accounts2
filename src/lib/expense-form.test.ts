import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ExpenseFormValidationError, parseExpenseForm, type ExpenseFormInput } from "./expense-form"

const valid: ExpenseFormInput = {
  categoryId: "cat-1", date: "2026-09-28", supplier: "Vendor", description: "Monthly service",
  netAmount: "12.34", vatRate: "20", paymentMethod: "bank_transfer", reference: "INV-1",
  clientId: "", notes: "", isReimbursable: null, isBillable: null,
}

describe("parseExpenseForm", () => {
  it("parses pence and maps the empty client selector to null", () => {
    const result = parseExpenseForm(valid)
    assert.equal(result.netAmount, 1234)
    assert.equal(result.vatAmount, 247)
    assert.equal(result.grossAmount, 1481)
    assert.equal(result.clientId, null)
    assert.equal(result.date.toISOString(), "2026-09-28T00:00:00.000Z")
  })

  it("rejects malformed money instead of silently creating a zero amount", () => {
    for (const amount of ["abc", "", "1.234", "1e2", "1.2.3", "0.00"]) {
      assert.throws(() => parseExpenseForm({ ...valid, netAmount: amount }), ExpenseFormValidationError)
    }
  })

  it("accepts a signed refund while preserving balanced integer pence", () => {
    const result = parseExpenseForm({ ...valid, netAmount: "-12.34" })
    assert.equal(result.netAmount, -1234)
    assert.equal(result.vatAmount, -247)
    assert.equal(result.grossAmount, -1481)
  })

  it("rejects impossible calendar dates and unsupported VAT rates", () => {
    assert.throws(() => parseExpenseForm({ ...valid, date: "2026-02-30" }), /valid date/i)
    assert.throws(() => parseExpenseForm({ ...valid, vatRate: "17" }), /VAT rate/i)
  })

  it("rejects missing descriptions and unsafe money magnitudes", () => {
    assert.throws(() => parseExpenseForm({ ...valid, description: " " }), /required/i)
    assert.throws(() => parseExpenseForm({ ...valid, netAmount: "999999999999999999999" }), /supported range/i)
    assert.throws(() => parseExpenseForm({ ...valid, netAmount: "21474836.48" }), /supported range/i)
  })
})
