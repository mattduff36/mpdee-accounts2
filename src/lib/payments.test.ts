import assert from "node:assert/strict"
import { afterEach, mock, test } from "node:test"
import {
  isEligibleMarkPaidStatus,
  invoiceSendMode,
  markInvoicePaid,
  MarkPaidError,
  remainingBalanceToPay,
  type MarkPaidDb,
  type MarkPaidInvoice,
  type MarkPaidTx,
} from "./payments"

afterEach(() => {
  mock.restoreAll()
})

function invoice(overrides: Partial<MarkPaidInvoice> = {}): MarkPaidInvoice {
  return {
    id: "inv_1",
    clientId: "cli_1",
    status: "sent",
    total: 10_000,
    amountPaid: 0,
    balanceDue: 10_000,
    ...overrides,
  }
}

function createDb(initial: MarkPaidInvoice | null, options?: { failUpdate?: boolean }): {
  db: MarkPaidDb
  state: {
    invoice: MarkPaidInvoice | null
    payments: Array<Record<string, unknown>>
    committedPayments: Array<Record<string, unknown>>
    lockAcquired: boolean
  }
} {
  const state = {
    invoice: initial ? { ...initial } : null,
    payments: [] as Array<Record<string, unknown>>,
    committedPayments: [] as Array<Record<string, unknown>>,
    lockAcquired: false,
  }

  const db: MarkPaidDb = {
    async $transaction(fn) {
      state.lockAcquired = false
      const snapshotPayments = [...state.payments]
      const snapshotInvoice = state.invoice ? { ...state.invoice } : null
      const tx: MarkPaidTx = {
        $executeRaw: async () => {
          state.lockAcquired = true
          return 1
        },
        invoice: {
          findUnique: async ({ where }) => {
            if (!state.lockAcquired) throw new Error("Invoice read before advisory lock")
            if (!state.invoice || state.invoice.id !== where.id) return null
            return { ...state.invoice }
          },
          update: async ({ where, data }) => {
            if (options?.failUpdate) throw new Error("forced invoice-update failure")
            if (!state.invoice || state.invoice.id !== where.id) throw new Error("Invoice not found")
            Object.assign(state.invoice, data)
            return state.invoice
          },
        },
        payment: {
          create: async ({ data }) => {
            const payment = { id: `pay_${state.payments.length + 1}`, ...data }
            state.payments.push(payment)
            return { id: payment.id as string }
          },
        },
      }
      try {
        const result = await fn(tx)
        state.committedPayments = [...state.payments]
        return result
      } catch (error) {
        state.payments = snapshotPayments
        state.invoice = snapshotInvoice
        throw error
      }
    },
  }

  return { db, state }
}

test("T1 / PAY-STATUS-001: eligible statuses are allowed", () => {
  for (const status of ["sent", "viewed", "partial", "overdue"]) {
    assert.equal(isEligibleMarkPaidStatus(status), true)
  }
})

test("T2 / PAY-STATUS-001: ineligible and unknown statuses are rejected", () => {
  for (const status of ["draft", "paid", "cancelled", "written_off", "unknown"]) {
    assert.equal(isEligibleMarkPaidStatus(status), false)
  }
})

test("invoiceSendMode maps draft to send and unpaid issued invoices to resend", () => {
  assert.equal(invoiceSendMode("draft"), "send")
  assert.equal(invoiceSendMode("sent"), "resend")
  assert.equal(invoiceSendMode("paid"), null)
})

test("T3 / PAY-PARTIAL-001: remaining balance equals derived amount", () => {
  assert.equal(remainingBalanceToPay(invoice({ total: 10_000, amountPaid: 2_500, balanceDue: 7_500 })), 7_500)
})

test("T3: balanceDue 0 falls back to derived remaining", () => {
  assert.equal(remainingBalanceToPay(invoice({ total: 10_000, amountPaid: 4_000, balanceDue: 0 })), 6_000)
})

test("T3: derived <= 0 is rejected", () => {
  assert.throws(
    () => remainingBalanceToPay(invoice({ total: 10_000, amountPaid: 10_000, balanceDue: 0 })),
    MarkPaidError
  )
})

test("T3: inconsistent positive balanceDue is rejected", () => {
  assert.throws(
    () => remainingBalanceToPay(invoice({ total: 10_000, amountPaid: 2_000, balanceDue: 1_000 })),
    MarkPaidError
  )
})

test("T4 / PAY-PARTIAL-001: mark-paid writes remaining payment and paid invoice fields", async () => {
  const now = new Date("2026-08-19T12:00:00.000Z")
  const { db, state } = createDb(invoice({ status: "partial", amountPaid: 2_500, balanceDue: 7_500 }))
  const emails: Array<{ invoiceId: string; amount?: number }> = []

  const result = await markInvoicePaid("inv_1", {
    db,
    now,
    sendPaymentReceivedEmail: async (invoiceId, options) => {
      emails.push({ invoiceId, amount: options?.amountPaidPence })
      return { ok: true }
    },
  })

  assert.equal(result.amount, 7_500)
  assert.equal(state.committedPayments.length, 1)
  assert.equal(state.committedPayments[0].amount, 7_500)
  assert.equal(state.committedPayments[0].method, "bank_transfer")
  assert.equal(state.committedPayments[0].notes, "Marked as paid")
  assert.equal(state.committedPayments[0].date, now)
  assert.equal(state.invoice?.status, "paid")
  assert.equal(state.invoice?.amountPaid, 10_000)
  assert.equal(state.invoice?.balanceDue, 0)
  assert.equal(state.invoice?.paidAt, now)
  assert.deepEqual(emails, [{ invoiceId: "inv_1", amount: 7_500 }])
})

test("PAY-STATUS-001: ineligible status creates no payment", async () => {
  const { db, state } = createDb(invoice({ status: "draft" }))
  await assert.rejects(() => markInvoicePaid("inv_1", { db, sendPaymentReceivedEmail: async () => ({ ok: true }) }), MarkPaidError)
  assert.equal(state.committedPayments.length, 0)
  assert.equal(state.invoice?.status, "draft")
})

test("T5: second mark-paid does not create another payment", async () => {
  const { db, state } = createDb(invoice())
  await markInvoicePaid("inv_1", { db, sendPaymentReceivedEmail: async () => ({ ok: true }) })
  await assert.rejects(() => markInvoicePaid("inv_1", { db, sendPaymentReceivedEmail: async () => ({ ok: true }) }), (error: unknown) => {
    return error instanceof MarkPaidError && error.httpStatus === 409
  })
  assert.equal(state.committedPayments.length, 1)
})

test("PAY-ATOMIC-001: invoice update failure rolls back payment creation", async () => {
  const { db, state } = createDb(invoice(), { failUpdate: true })
  await assert.rejects(
    () => markInvoicePaid("inv_1", { db, sendPaymentReceivedEmail: async () => ({ ok: true }) }),
    /forced invoice-update failure/
  )
  assert.equal(state.committedPayments.length, 0)
  assert.equal(state.payments.length, 0)
  assert.equal(state.invoice?.status, "sent")
})

test("PAY-CONCURRENT-001: overlapping requests create exactly one payment", async () => {
  const { db, state } = createDb(invoice())
  let firstEntered!: () => void
  const firstHasLock = new Promise<void>((resolve) => {
    firstEntered = resolve
  })
  let releaseFirst!: () => void
  const firstMayFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  let waiting = 0

  let held = false
  const gatedDb: MarkPaidDb = {
    async $transaction(fn) {
      if (held) {
        waiting += 1
        await firstMayFinish
      }
      held = true
      firstEntered()
      try {
        return await db.$transaction(async (tx) => {
          const result = await fn(tx)
          await firstMayFinish
          return result
        })
      } finally {
        held = false
      }
    },
  }

  const first = markInvoicePaid("inv_1", {
    db: gatedDb,
    sendPaymentReceivedEmail: async () => ({ ok: true }),
  })
  await firstHasLock
  const second = markInvoicePaid("inv_1", {
    db: gatedDb,
    sendPaymentReceivedEmail: async () => ({ ok: true }),
  })
  releaseFirst()

  const firstResult = await first
  await assert.rejects(second, (error: unknown) => error instanceof MarkPaidError && error.httpStatus === 409)
  assert.equal(firstResult.amount, 10_000)
  assert.equal(state.committedPayments.length, 1)
  assert.equal(waiting, 1)
})

test("PAY-EMAIL-001: returned email failure still commits payment", async () => {
  const logs: Array<{ message: string; extra?: Record<string, unknown> }> = []
  const { db, state } = createDb(invoice())
  const result = await markInvoicePaid("inv_1", {
    db,
    sendPaymentReceivedEmail: async () => ({ ok: false, error: "provider down" }),
    logError: (message, extra) => logs.push({ message, extra }),
  })
  assert.equal(result.paymentId, "pay_1")
  assert.equal(state.committedPayments.length, 1)
  assert.equal(state.invoice?.status, "paid")
  assert.equal(logs.length, 1)
  assert.match(logs[0].message, /email failed/)
})

test("PAY-EMAIL-001: thrown email failure still commits payment", async () => {
  const logs: Array<{ message: string }> = []
  const { db, state } = createDb(invoice())
  const result = await markInvoicePaid("inv_1", {
    db,
    sendPaymentReceivedEmail: async () => {
      throw new Error("smtp exploded")
    },
    logError: (message) => logs.push({ message }),
  })
  assert.equal(result.paymentId, "pay_1")
  assert.equal(state.committedPayments.length, 1)
  assert.equal(logs.length, 1)
  assert.match(logs[0].message, /email threw/)
})

test("PAY-EMAIL-AMOUNT-001: email receives the remaining payment amount", async () => {
  const { db } = createDb(invoice({ status: "partial", amountPaid: 3_000, balanceDue: 7_000 }))
  let emailedAmount: number | undefined
  await markInvoicePaid("inv_1", {
    db,
    sendPaymentReceivedEmail: async (_invoiceId, options) => {
      emailedAmount = options?.amountPaidPence
      return { ok: true }
    },
  })
  assert.equal(emailedAmount, 7_000)
})

test("missing invoice is not_found", async () => {
  const { db } = createDb(null)
  await assert.rejects(
    () => markInvoicePaid("missing", { db, sendPaymentReceivedEmail: async () => ({ ok: true }) }),
    (error: unknown) => error instanceof MarkPaidError && error.httpStatus === 404
  )
})
