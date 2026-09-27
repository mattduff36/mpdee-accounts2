import assert from "node:assert/strict"
import { test } from "node:test"
import { WriteAccessError } from "@/lib/auth"
import { MarkPaidError } from "@/lib/payments"
import { postMarkPaid } from "./handler"

test("T6 / PAY-AUTH-001: unauthenticated request returns 401 without mutation", async () => {
  let marked = false
  const response = await postMarkPaid("inv_1", {
    requireApiWrite: async () => {
      throw new Error("Authentication required")
    },
    markInvoicePaid: async () => {
      marked = true
      return { paymentId: "pay_1", amount: 100, invoiceId: "inv_1" }
    },
  })
  assert.equal(response.status, 401)
  assert.equal(marked, false)
  assert.deepEqual(await response.json(), { success: false, error: "Authentication required" })
})

test("authenticated mark-paid returns success payload", async () => {
  const response = await postMarkPaid("inv_1", {
    requireApiWrite: async () => ({ id: "user_1" }),
    markInvoicePaid: async () => ({ paymentId: "pay_1", amount: 5000, invoiceId: "inv_1" }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    success: true,
    paymentId: "pay_1",
    amount: 5000,
    invoiceId: "inv_1",
  })
})

test("ineligible invoice maps to 409", async () => {
  const response = await postMarkPaid("inv_1", {
    requireApiWrite: async () => ({ id: "user_1" }),
    markInvoicePaid: async () => {
      throw new MarkPaidError("conflict", "Invoice is already paid")
    },
  })
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), { success: false, error: "Invoice is already paid" })
})

test("RO-API-403-001: read-only mark-paid returns 403 without mutation", async () => {
  let marked = false
  const response = await postMarkPaid("inv_1", {
    requireApiWrite: async () => {
      throw new WriteAccessError()
    },
    markInvoicePaid: async () => {
      marked = true
      return { paymentId: "pay_1", amount: 100, invoiceId: "inv_1" }
    },
  })
  assert.equal(response.status, 403)
  assert.equal(marked, false)
  assert.deepEqual(await response.json(), { success: false, error: "Read-only access" })
})

test("RO-API-500-001: mark-paid hides internal errors", async () => {
  const response = await postMarkPaid("inv_1", {
    requireApiWrite: async () => ({ id: "user_1" }),
    markInvoicePaid: async () => {
      throw new Error("connection string leaked")
    },
  })
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { success: false, error: "Failed to mark invoice as paid" })
})
