import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertRealShadow } from './shadow-target'

test('local refresh refuses the fixture database and remote hosts', () => {
  assert.doesNotThrow(() => assertRealShadow('postgresql://shadow@127.0.0.1:54329/mpdee_accounts_shadow_real'))
  assert.throws(() => assertRealShadow('postgresql://shadow@127.0.0.1:54329/mpdee_accounts_shadow'), /mpdee_accounts_shadow_real/)
  assert.throws(() => assertRealShadow('postgresql://user:secret@example.neon.tech/accounts'), /non-local|Refusing/)
})
