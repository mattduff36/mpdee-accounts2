import assert from "node:assert/strict"
import { test } from "node:test"
import { canWrite } from "./auth"

test("RO-ROLE-001: unknown, blank, and mixed-case roles cannot write", () => {
  assert.equal(canWrite({ role: "readonly" }), false)
  assert.equal(canWrite({ role: "" }), false)
  assert.equal(canWrite({ role: "Admin" }), false)
  assert.equal(canWrite({ role: "READONLY" }), false)
  assert.equal(canWrite({ role: "read-only" }), false)
  assert.equal(canWrite({ role: "admin " }), false)
})

test("RO-ROLE-002: only an exact admin can write", () => {
  assert.equal(canWrite({ role: "admin" }), true)
  assert.equal(canWrite({ role: "readonly" }), false)
  assert.equal(canWrite(null), false)
  assert.equal(canWrite(undefined), false)
})
