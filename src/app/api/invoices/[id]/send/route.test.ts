import assert from "node:assert/strict"
import { test } from "node:test"
import { WriteAccessError } from "@/lib/auth"
import { postSendInvoice } from "./handler"

test("RO-API-401-002: unauthenticated send returns 401 without mutation", async () => {
  let sent = false
  const response = await postSendInvoice("inv_1", {
    requireApiWrite: async () => {
      throw new Error("Authentication required")
    },
    sendInvoiceEmail: async () => {
      sent = true
      return { ok: true }
    },
  })
  assert.equal(response.status, 401)
  assert.equal(sent, false)
  assert.deepEqual(await response.json(), { success: false, error: "Authentication required" })
})

test("authenticated send returns success", async () => {
  const response = await postSendInvoice("inv_1", {
    requireApiWrite: async () => ({ id: "user_1" }),
    sendInvoiceEmail: async () => ({ ok: true }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { success: true })
})

test("RO-API-403-002: read-only send returns 403 without mutation", async () => {
  let sent = false
  const response = await postSendInvoice("inv_1", {
    requireApiWrite: async () => {
      throw new WriteAccessError()
    },
    sendInvoiceEmail: async () => {
      sent = true
      return { ok: true }
    },
  })
  assert.equal(response.status, 403)
  assert.equal(sent, false)
  assert.deepEqual(await response.json(), { success: false, error: "Read-only access" })
})

test("RO-API-500-002: send hides internal errors", async () => {
  const response = await postSendInvoice("inv_1", {
    requireApiWrite: async () => ({ id: "user_1" }),
    sendInvoiceEmail: async () => {
      throw new Error("connection string leaked")
    },
  })
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { success: false, error: "Failed to send invoice" })
})
