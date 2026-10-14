import test from 'node:test'
import assert from 'node:assert/strict'
import { MANUAL_SPLIT_MARKER, parentSourceKey, splitBigint } from './split-units'

test('equal splits conserve units and give the remainder to earlier project ids', () => {
  assert.deepEqual(Array.from(splitBigint(null, ['b', 'a'])), [['a', null], ['b', null]])
  assert.equal(splitBigint(BigInt(0), ['a']).get('a'), BigInt(0))
  const odd = splitBigint(BigInt(1), ['b', 'a'])
  assert.equal(odd.get('a'), BigInt(1))
  assert.equal(odd.get('b'), BigInt(0))
  const five = splitBigint(BigInt(5), ['b', 'a'])
  assert.equal(five.get('a'), BigInt(3))
  assert.equal(five.get('b'), BigInt(2))
  assert.equal(Array.from(five.values()).reduce<bigint>((sum, value) => sum + (value ?? BigInt(0)), BigInt(0)), BigInt(5))
  const negative = splitBigint(BigInt(-5), ['b', 'a'])
  assert.equal(negative.get('a'), BigInt(-3))
  assert.equal(negative.get('b'), BigInt(-2))
  assert.equal(parentSourceKey(`hash:1${MANUAL_SPLIT_MARKER}project`), 'hash:1')
  assert.equal(parentSourceKey('hash:10'), null)
  assert.throws(() => splitBigint(BigInt(1), ['a', 'a']), /unique/)
})
