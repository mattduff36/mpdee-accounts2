import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { validProjectReadToken } from './project-read-auth'

const digest = (token: string) => createHash('sha256').update(token).digest('hex')
test('project read token only grants the exact configured slug', () => {
  const token = 'project-token-for-project-alpha-123456789'
  const map = JSON.stringify({ alpha: digest(token), beta: digest('another-project-token-123456789') })
  assert.equal(validProjectReadToken(`Bearer ${token}`, 'alpha', map), true)
  assert.equal(validProjectReadToken(`Bearer ${token}`, 'beta', map), false)
  assert.equal(validProjectReadToken(`Bearer ${token}`, 'alpha-extra', map), false)
  assert.equal(validProjectReadToken(null, 'alpha', map), false)
  assert.throws(() => validProjectReadToken(`Bearer ${token}`, 'alpha', undefined))
})

test('malformed credential maps fail closed', () => {
  for (const config of ['{', '[]', '{}', '{"Bad Slug":"' + 'a'.repeat(64) + '"}', '{"alpha":"short"}', '{"alpha":4}']) {
    assert.throws(() => validProjectReadToken('Bearer any-token', 'alpha', config))
  }
})

test('non-bearer and whitespace-padded credentials are rejected', () => {
  const token = 'a-valid-looking-token-value-123456789'
  const map = JSON.stringify({ alpha: digest(token) })
  assert.equal(validProjectReadToken(token, 'alpha', map), false)
  assert.equal(validProjectReadToken(`Bearer ${token} `, 'alpha', map), false)
})
