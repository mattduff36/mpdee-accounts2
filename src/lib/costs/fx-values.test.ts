import test from 'node:test'
import assert from 'node:assert/strict'
import {parseEcbRates,quoteFor,convertUnits,formatGbpUnits} from './fx-values'
test('ECB cross rates preserve GBP base and reject future/stale quotes',()=>{
  const rates=parseEcbRates(`<Cube time='2026-09-25'><Cube currency='USD' rate='1.20'/><Cube currency='GBP' rate='0.90'/></Cube>`)
  assert.equal(quoteFor(rates,'USD','2026-09-27')?.rate,'0.75000000')
  assert.equal(quoteFor(rates,'USD','2026-09-24'),null)
  assert.equal(quoteFor(rates,'USD','2026-10-10'),null)
  assert.equal(formatGbpUnits(convertUnits(BigInt(10000000),quoteFor(rates,'USD','2026-09-27'))),'£0.75')
  assert.equal(convertUnits(BigInt(100),null),null)
  assert.equal(convertUnits(BigInt(0),null),BigInt(0))
  assert.equal(formatGbpUnits(convertUnits(BigInt(-10000000),quoteFor(rates,'USD','2026-09-27'))),'-£0.75')
})
test('malformed provider quotes are skipped without corrupting valid currencies',()=>{
  const rates=parseEcbRates(`<Cube time='2026-09-25'><Cube currency='USD' rate='1..2'/><Cube currency='GBP' rate='0.90'/></Cube>`)
  assert.equal(quoteFor(rates,'USD','2026-09-25'),null)
  assert.equal(quoteFor(rates,'EUR','2026-09-25')?.rate,'0.90000000')
})
