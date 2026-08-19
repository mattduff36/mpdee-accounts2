import assert from "node:assert/strict"
import { test } from "node:test"
import { SAFETY_CONTRACT, TRUSTED_OPERATIONAL_ACTIONS } from "./trusted-operational-actions"

test("accounts-finalise-v1 registers finalise and fap with zero DB mutations", () => {
  assert.equal(SAFETY_CONTRACT, "accounts-finalise-v1")
  assert.deepEqual(TRUSTED_OPERATIONAL_ACTIONS.finalise.allowedDbMutations, [])
  assert.deepEqual(TRUSTED_OPERATIONAL_ACTIONS.fap.allowedDbMutations, [])
  assert.equal(TRUSTED_OPERATIONAL_ACTIONS.finalise.allowsPush, false)
  assert.equal(TRUSTED_OPERATIONAL_ACTIONS.fap.allowsPush, true)
  assert.equal(TRUSTED_OPERATIONAL_ACTIONS.fap.safetyContract, SAFETY_CONTRACT)
})
