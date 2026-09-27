import assert from "node:assert/strict"
import { test } from "node:test"
import { confirmButtonLabel } from "./confirm-button-label"

test("save and clear buttons show a short confirmation, or ERROR", () => {
  assert.equal(confirmButtonLabel("Save", "idle"), "Save")
  assert.equal(confirmButtonLabel("Save", "success"), "Saved")
  assert.equal(confirmButtonLabel("Clear", "idle"), "Clear")
  assert.equal(confirmButtonLabel("Clear", "success"), "Cleared")
  assert.equal(confirmButtonLabel("Save", "error"), "ERROR")
  assert.equal(confirmButtonLabel("Clear", "error"), "ERROR")
})
