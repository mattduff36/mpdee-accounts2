import assert from "node:assert/strict"
import { test } from "node:test"
import { addCalendarDays, parseInvoiceImportJson } from "./import-invoice-json"

const SAMPLE = {
  schemaVersion: 1,
  title: "Invoice summary: 1–19 August 2026",
  period: {
    from: "2026-08-01",
    to: "2026-08-19",
    label: "1–19 August 2026",
  },
  lines: [
    {
      kind: "development",
      label: "Development Session",
      dateLabel: "5–6 August 2026",
      heading: "Payroll",
      description: "Added payroll rules",
      hours: 3,
      rate: 28,
      amount: 84,
      text: "Development Session: 5–6 August 2026 (Payroll — Added payroll rules) — 3h × £28 = £84",
    },
    {
      kind: "support",
      label: "BUG FIXES / Production Support",
      dateLabel: "5–19 August 2026",
      heading: null,
      description: "Corrected kiosk errors",
      hours: 6,
      rate: 5,
      amount: 30,
      text: "BUG FIXES / Production Support: 5–19 August 2026 (Corrected kiosk errors) — 6h × £5 = £30",
    },
  ],
  coverageNotes: ["Period: 1 August 2026 to 19 August 2026.", "Excluded planning-only chats."],
}

test("parses a final invoice JSON export into form fields", () => {
  const draft = parseInvoiceImportJson(JSON.stringify(SAMPLE), { paymentTerms: 7 })

  assert.equal(draft.issueDate, "2026-08-19")
  assert.equal(draft.dueDate, "2026-08-26")
  assert.equal(draft.notes, "Invoice summary: 1–19 August 2026")
  assert.equal(draft.internalNotes, "Period: 1 August 2026 to 19 August 2026.\n\nExcluded planning-only chats.")
  assert.equal(draft.items.length, 2)

  assert.deepEqual(draft.items[0], {
    description: "Development Session: 5–6 August 2026 (Payroll — Added payroll rules)",
    quantity: "3",
    unitPrice: "28.00",
    agencyCommission: "0",
    businessArea: "DEVELOPMENT",
  })
  assert.deepEqual(draft.items[1], {
    description: "BUG FIXES / Production Support: 5–19 August 2026 (Corrected kiosk errors)",
    quantity: "6",
    unitPrice: "5.00",
    agencyCommission: "0",
    businessArea: "SUPPORT",
  })
})

test("builds a description from structured fields when text is missing", () => {
  const draft = parseInvoiceImportJson(
    JSON.stringify({
      schemaVersion: 1,
      lines: [
        {
          kind: "development",
          label: "Development Session",
          dateLabel: "19 August 2026",
          heading: "Yard inventory",
          description: "Added unallocated yard take",
          hours: 2,
          rate: 28,
        },
      ],
    }),
  )

  assert.equal(
    draft.items[0]?.description,
    "Development Session: 19 August 2026 (Yard inventory — Added unallocated yard take)",
  )
})

test("keeps rates in pounds for the form Rate field", () => {
  const draft = parseInvoiceImportJson(JSON.stringify(SAMPLE))
  assert.equal(draft.items[0]?.unitPrice, "28.00")
  assert.notEqual(draft.items[0]?.unitPrice, "2800")
})

test("addCalendarDays stays on the local calendar and crosses months", () => {
  assert.equal(addCalendarDays("2026-08-19", 7), "2026-08-26")
  assert.equal(addCalendarDays("2026-08-28", 7), "2026-09-04")
})

test("rejects invalid JSON", () => {
  assert.throws(() => parseInvoiceImportJson("{"), /not valid JSON/)
})

test("rejects evidence JSON without a lines array", () => {
  assert.throws(
    () => parseInvoiceImportJson(JSON.stringify({ generatedAt: "2026-08-19T17:37:50.378Z", period: { to: "2026-08-19" } })),
    /final invoice export/,
  )
})

test("rejects an empty lines array", () => {
  assert.throws(() => parseInvoiceImportJson(JSON.stringify({ schemaVersion: 1, lines: [] })), /does not contain any line items/)
})
