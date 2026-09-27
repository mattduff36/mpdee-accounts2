import assert from "node:assert/strict"
import { test } from "node:test"
import { andVisibleInvoice, visibleInvoiceOrNull, visibleInvoiceWhere } from "./invoice-visibility"

test("visible invoice filter defaults to showing every invoice", () => {
  assert.deepEqual(visibleInvoiceWhere, { viewHidden: false })
  assert.deepEqual(andVisibleInvoice({ status: "paid" }), {
    AND: [{ status: "paid" }, { viewHidden: false }],
  })
})

test("visibleInvoiceOrNull drops a hidden invoice", () => {
  assert.equal(visibleInvoiceOrNull(null), null)
  assert.equal(visibleInvoiceOrNull({ id: "hidden", viewHidden: true }), null)
  assert.deepEqual(visibleInvoiceOrNull({ id: "shown", viewHidden: false }), {
    id: "shown",
    viewHidden: false,
  })
})
