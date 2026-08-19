import assert from "node:assert/strict"
import { test } from "node:test"
import { formatIsoDateOnly, parseIsoDateOnly } from "./invoice-date"
import { calculateInvoiceDraftLine } from "./invoice-items"
import { invoiceSendLockKey } from "./invoice-send-lock"
import {
  InvoiceEditError,
  updateDraftInvoice,
  type DraftEditDb,
  type DraftEditTx,
  type DraftInvoiceUpdateInput,
} from "./update-draft-invoice"

type InvoiceState = {
  id: string
  invoiceNumber: string
  status: string
  amountPaid: number
  sentAt: Date | null
  viewedAt: Date | null
  paidAt: Date | null
  cancelledAt: Date | null
  writtenOffAt: Date | null
  clientId: string
  paymentTerms: number
  issueDate: Date
  dueDate: Date
  notes: string
  internalNotes: string
  subtotal: number
  vatTotal: number
  discountTotal: number
  total: number
  balanceDue: number
}

function draftInvoice(overrides: Partial<InvoiceState> = {}): InvoiceState {
  return {
    id: "inv_1",
    invoiceNumber: "MPD-2026-001",
    status: "draft",
    amountPaid: 0,
    sentAt: null,
    viewedAt: null,
    paidAt: null,
    cancelledAt: null,
    writtenOffAt: null,
    clientId: "cli_1",
    paymentTerms: 30,
    issueDate: new Date("2026-07-01T00:00:00.000Z"),
    dueDate: new Date("2026-07-31T00:00:00.000Z"),
    notes: "old notes",
    internalNotes: "old internal",
    subtotal: 1000,
    vatTotal: 0,
    discountTotal: 0,
    total: 1000,
    balanceDue: 1000,
    ...overrides,
  }
}

function validInput(overrides: Partial<DraftInvoiceUpdateInput> = {}): DraftInvoiceUpdateInput {
  return {
    clientId: "cli_1",
    paymentTerms: "7",
    issueDate: "2026-08-19",
    dueDate: "2026-08-26",
    notes: "Updated notes",
    internalNotes: "Updated internal",
    descriptions: ["Development Session"],
    quantities: ["3"],
    unitPrices: ["28.00"],
    commissions: ["0"],
    areas: ["DEVELOPMENT"],
    ...overrides,
  }
}

function createDb(
  initial: InvoiceState | null,
  options: {
    pendingSend?: boolean
    paymentCount?: number
    creditCount?: number
    flipToSentAfterRead?: boolean
    failUpdate?: boolean
    failCreate?: boolean
    clients?: string[]
  } = {},
) {
  const state = {
    invoice: initial ? { ...initial } : null,
    items: initial
      ? [{ invoiceId: initial.id, description: "Old line", quantity: 1, unitPrice: 1000, lineTotal: 1000 }]
      : [],
    pendingSend: options.pendingSend ?? false,
    paymentCount: options.paymentCount ?? 0,
    creditCount: options.creditCount ?? 0,
    lockAcquired: false,
    writes: 0,
  }

  const db: DraftEditDb = {
    async $transaction(fn) {
      state.lockAcquired = false
      const snapshot = {
        invoice: state.invoice ? { ...state.invoice } : null,
        items: state.items.map((item) => ({ ...item })),
        writes: state.writes,
      }
      const tx: DraftEditTx = {
        $executeRaw: async (strings, value) => {
          assert.equal(String.raw({ raw: strings }, value), `SELECT pg_advisory_xact_lock(hashtext(${invoiceSendLockKey("inv_1")}))`)
          state.lockAcquired = true
          return 1
        },
        invoice: {
          findUnique: async ({ where }) => {
            if (!state.lockAcquired) throw new Error("Invoice read before advisory lock")
            if (!state.invoice || state.invoice.id !== where.id) return null
            const current = { ...state.invoice }
            if (options.flipToSentAfterRead && state.invoice) {
              state.invoice.status = "sent"
            }
            return current
          },
          updateMany: async ({ where, data }) => {
            state.writes += 1
            if (options.failUpdate) throw new Error("forced invoice-update failure")
            if (!state.invoice || state.invoice.id !== where.id || state.invoice.status !== where.status) {
              return { count: 0 }
            }
            Object.assign(state.invoice, data)
            return { count: 1 }
          },
        },
        invoiceItem: {
          deleteMany: async ({ where }) => {
            state.writes += 1
            state.items = state.items.filter((item) => item.invoiceId !== where.invoiceId)
            return { count: 1 }
          },
          createMany: async ({ data }) => {
            state.writes += 1
            if (options.failCreate) throw new Error("forced item-create failure")
            state.items = data.map((item) => ({ ...item })) as typeof state.items
            return { count: data.length }
          },
        },
        client: {
          findUnique: async ({ where }) => {
            const clients = options.clients ?? ["cli_1"]
            return clients.includes(where.id) ? { id: where.id } : null
          },
        },
        emailLog: {
          findFirst: async () => (state.pendingSend ? { id: "email_pending" } : null),
        },
        payment: {
          count: async () => state.paymentCount,
        },
        creditNote: {
          count: async () => state.creditCount,
        },
      }
      try {
        return await fn(tx)
      } catch (error) {
        state.invoice = snapshot.invoice
        state.items = snapshot.items
        state.writes = snapshot.writes
        if (options.flipToSentAfterRead && state.invoice) {
          state.invoice.status = "sent"
        }
        throw error
      }
    },
  }

  return { db, state }
}

test("INV-EDIT-001: draft update replaces items and pence totals/balanceDue", async () => {
  const { db, state } = createDb(draftInvoice())
  const result = await updateDraftInvoice("inv_1", validInput(), { db })
  assert.equal(result.total, 8400)
  assert.equal(state.invoice?.subtotal, 8400)
  assert.equal(state.invoice?.total, 8400)
  assert.equal(state.invoice?.balanceDue, 8400)
  assert.equal(state.invoice?.vatTotal, 0)
  assert.equal(state.items.length, 1)
  assert.equal(state.items[0]?.description, "Development Session")
  assert.equal(state.items[0]?.unitPrice, 2800)
  assert.equal(state.items[0]?.lineTotal, 8400)
})

test("INV-EDIT-002: non-draft invoice produces no writes", async () => {
  const { db, state } = createDb(draftInvoice({ status: "sent" }))
  await assert.rejects(() => updateDraftInvoice("inv_1", validInput(), { db }), (error: unknown) => {
    assert.ok(error instanceof InvoiceEditError)
    assert.equal(error.redirectKey, "not-draft")
    return true
  })
  assert.equal(state.writes, 0)
  assert.equal(state.invoice?.notes, "old notes")
  assert.equal(state.items[0]?.description, "Old line")
})

test("INV-EDIT-003: missing invoice produces no writes", async () => {
  const { db, state } = createDb(null)
  await assert.rejects(() => updateDraftInvoice("inv_1", validInput(), { db }), (error: unknown) => {
    assert.ok(error instanceof InvoiceEditError)
    assert.equal(error.code, "not_found")
    return true
  })
  assert.equal(state.writes, 0)
  assert.equal(state.items.length, 0)
})

test("INV-EDIT-004: empty effective item list produces no writes", async () => {
  const { db, state } = createDb(draftInvoice())
  await assert.rejects(
    () => updateDraftInvoice("inv_1", validInput({ descriptions: ["  "], quantities: ["1"], unitPrices: ["10.00"] }), { db }),
    (error: unknown) => {
      assert.ok(error instanceof InvoiceEditError)
      assert.equal(error.redirectKey, "empty-items")
      return true
    },
  )
  assert.equal(state.writes, 0)
  assert.equal(state.items[0]?.description, "Old line")
})

test("INV-EDIT-005: number, status, payment, and lifecycle fields remain unchanged", async () => {
  const sentAt = new Date("2026-08-01T12:00:00.000Z")
  const { db, state } = createDb(
    draftInvoice({
      sentAt,
      viewedAt: sentAt,
    }),
  )
  await updateDraftInvoice("inv_1", validInput(), { db })
  assert.equal(state.invoice?.invoiceNumber, "MPD-2026-001")
  assert.equal(state.invoice?.status, "draft")
  assert.equal(state.invoice?.amountPaid, 0)
  assert.equal(state.invoice?.sentAt, sentAt)
  assert.equal(state.invoice?.viewedAt, sentAt)
  assert.equal(state.invoice?.paidAt, null)
  assert.equal(state.invoice?.cancelledAt, null)
  assert.equal(state.invoice?.writtenOffAt, null)
})

test("INV-EDIT-006: commission math exactly matches creation", async () => {
  const { db, state } = createDb(draftInvoice())
  const expected = calculateInvoiceDraftLine(3, 2800, 10)
  await updateDraftInvoice(
    "inv_1",
    validInput({
      commissions: ["10"],
    }),
    { db },
  )
  assert.equal(state.invoice?.total, expected.lineTotal)
  assert.equal(state.items[0]?.lineTotal, expected.lineTotal)
  assert.equal(expected.lineTotal, 7560)
})

test("INV-EDIT-007: pending/concurrent send blocks editing without modifying invoice contents", async () => {
  const pending = createDb(draftInvoice(), { pendingSend: true })
  await assert.rejects(() => updateDraftInvoice("inv_1", validInput(), { db: pending.db }), (error: unknown) => {
    assert.ok(error instanceof InvoiceEditError)
    assert.equal(error.redirectKey, "pending-send")
    return true
  })
  assert.equal(pending.state.writes, 0)
  assert.equal(pending.state.items[0]?.description, "Old line")
  assert.equal(pending.state.invoice?.total, 1000)

  const raced = createDb(draftInvoice(), { flipToSentAfterRead: true })
  await assert.rejects(() => updateDraftInvoice("inv_1", validInput(), { db: raced.db }), (error: unknown) => {
    assert.ok(error instanceof InvoiceEditError)
    assert.equal(error.redirectKey, "not-draft")
    return true
  })
  assert.equal(raced.state.invoice?.notes, "old notes")
  assert.equal(raced.state.invoice?.total, 1000)
  assert.equal(raced.state.invoice?.status, "sent")
  assert.equal(raced.state.items[0]?.description, "Old line")
})

test("INV-EDIT-008: invalid or overflowing numeric inputs are rejected without writes", async () => {
  const { db, state } = createDb(draftInvoice())
  const cases: DraftInvoiceUpdateInput[] = [
    validInput({ quantities: ["-1"] }),
    validInput({ unitPrices: ["abc"] }),
    validInput({ commissions: ["150"] }),
    validInput({ unitPrices: ["30000000.00"] }),
    validInput({ paymentTerms: "9999" }),
    validInput({ areas: ["MARKETING"] }),
  ]
  for (const input of cases) {
    await assert.rejects(() => updateDraftInvoice("inv_1", input, { db }), InvoiceEditError)
    assert.equal(state.writes, 0)
    assert.equal(state.invoice?.total, 1000)
  }
})

test("INV-EDIT-009: date-only values round-trip exactly across timezone-independent helpers", () => {
  const parsed = parseIsoDateOnly("2026-08-19")
  assert.equal(parsed.toISOString(), "2026-08-19T00:00:00.000Z")
  assert.equal(formatIsoDateOnly(parsed), "2026-08-19")
  assert.equal(formatIsoDateOnly(new Date("2026-08-19T00:00:00.000Z")), "2026-08-19")
  assert.throws(() => parseIsoDateOnly("2026-02-31"), /Invalid date/)
  assert.throws(() => parseIsoDateOnly("19/08/2026"), /Invalid date/)
})

test("INV-EDIT-010: draft with payment state or financial records is rejected", async () => {
  const paid = createDb(draftInvoice({ amountPaid: 100 }))
  await assert.rejects(() => updateDraftInvoice("inv_1", validInput(), { db: paid.db }), (error: unknown) => {
    assert.ok(error instanceof InvoiceEditError)
    assert.equal(error.redirectKey, "has-payments")
    return true
  })
  assert.equal(paid.state.writes, 0)

  const withPayment = createDb(draftInvoice(), { paymentCount: 1 })
  await assert.rejects(() => updateDraftInvoice("inv_1", validInput(), { db: withPayment.db }), InvoiceEditError)
  assert.equal(withPayment.state.writes, 0)

  const withCredit = createDb(draftInvoice(), { creditCount: 1 })
  await assert.rejects(() => updateDraftInvoice("inv_1", validInput(), { db: withCredit.db }), InvoiceEditError)
  assert.equal(withCredit.state.writes, 0)
})

test("INV-EDIT-011: item-create or invoice-update failure restores the complete prior draft", async () => {
  const createFail = createDb(draftInvoice(), { failCreate: true })
  await assert.rejects(
    () => updateDraftInvoice("inv_1", validInput(), { db: createFail.db, logError: () => {} }),
    InvoiceEditError,
  )
  assert.equal(createFail.state.invoice?.notes, "old notes")
  assert.equal(createFail.state.invoice?.total, 1000)
  assert.equal(createFail.state.items[0]?.description, "Old line")

  const updateFail = createDb(draftInvoice(), { failUpdate: true })
  await assert.rejects(
    () => updateDraftInvoice("inv_1", validInput(), { db: updateFail.db, logError: () => {} }),
    InvoiceEditError,
  )
  assert.equal(updateFail.state.invoice?.notes, "old notes")
  assert.equal(updateFail.state.invoice?.total, 1000)
  assert.equal(updateFail.state.items[0]?.description, "Old line")
})

test("draft client can change and credit rates reduce the total", async () => {
  const { db, state } = createDb(draftInvoice(), { clients: ["cli_1", "cli_2"] })
  const result = await updateDraftInvoice(
    "inv_1",
    validInput({
      clientId: "cli_2",
      descriptions: ["Development Session", "Credit"],
      quantities: ["3", "1"],
      unitPrices: ["28.00", "-100.00"],
      commissions: ["0", "0"],
      areas: ["DEVELOPMENT", "DEVELOPMENT"],
    }),
    { db },
  )
  assert.equal(state.invoice?.clientId, "cli_2")
  assert.equal(result.total, 8400 - 10000)
  assert.equal(state.items[1]?.unitPrice, -10000)
  assert.equal(state.items[1]?.lineTotal, -10000)
})
