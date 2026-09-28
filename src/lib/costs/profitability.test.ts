import test from 'node:test'
import assert from 'node:assert/strict'
import { invoiceCosts, splitPence, validAllocation, parsePeriod } from './profitability'
import { suggestInvoicePeriod } from './invoice-association'
const period = parsePeriod('2026-09-01', '2026-09-02')
test('overlapping invoices share costs instead of duplicating them, including refund', () => {
 const invoices = [{ id:'a', projectId:'p', netPence:100, ...period }, { id:'b', projectId:'p', netPence:300, ...period }]
 const result = invoiceCosts(invoices, [{ id:'x', projectId:'p', amountPence:100, kind:'subscription', ...period }, { id:'y',projectId:'p',amountPence:-20,kind:'direct',...period }])
 assert.equal(Array.from(result.costs.values()).reduce((n,x)=>n+x.direct+x.subscription,0),80)
 assert.equal(result.unmatchedPence,0)
 assert.equal(result.costs.get('b')!.subscription,74)
})
test('unmatched days and signed penny rounding conserve every penny', () => {
 for (const amount of [101,-101,1,-1,0]) {
 const result=invoiceCosts([{id:'a',projectId:'p',netPence:100,...parsePeriod('2026-09-01','2026-09-01')}],[{id:'x',projectId:'p',amountPence:amount,kind:'direct',...period}])
 assert.equal(result.costs.get('a')!.direct+result.unmatchedPence,amount)
 }
 assert.deepEqual(Array.from(splitPence(-5,[{id:'a',weight:BigInt(1)},{id:'b',weight:BigInt(1)}]).values()),[-3,-2])
})
test('allocation caps, sign and date validation protect actual expenses', () => {
 assert.equal(validAllocation(100,60,40),true); assert.equal(validAllocation(100,61,40),false)
 assert.equal(validAllocation(-100,-60,-40),true); assert.equal(validAllocation(-100,60,-40),false)
 assert.throws(()=>parsePeriod('2026-02-30','2026-03-01')); assert.throws(()=>parsePeriod('2026-09-02','2026-09-01'))
})
test('period suggestions do not guess ambiguous months or absent years',()=>{
 assert.equal(suggestInvoicePeriod('September 2026 hosting')?.start,'2026-09-01')
 assert.equal(suggestInvoicePeriod('September hosting'),null)
 assert.equal(suggestInvoicePeriod('September 2026 to October 2026'),null)
})

test('invalid opposite-signed prior shares cannot permit over-allocation',()=>{
 assert.equal(validAllocation(100,150,-50),false)
 assert.equal(validAllocation(100,50,-25),false)
 assert.equal(validAllocation(-100,-150,50),false)
 assert.equal(validAllocation(100,1,NaN),false)
})
test('a fully credited invoice retains the costs of the work',()=>{
 const result=invoiceCosts([{id:'credited',projectId:'p',netPence:0,weightPence:100,...period}],[{id:'expense',projectId:'p',amountPence:40,kind:'direct',...period}])
 assert.equal(result.costs.get('credited')!.direct,40)
 assert.equal(result.unmatchedPence,0)
})
test('invoice suggestions preserve explicit service day ranges instead of expanding to a month',()=>{
 assert.deepEqual(suggestInvoicePeriod('Development 9–24 September 2026'),{start:'2026-09-09',end:'2026-09-24',evidence:'9–24 September 2026'})
 assert.equal(suggestInvoicePeriod('9 to 24 September 2026 work')?.end,'2026-09-24')
 assert.equal(suggestInvoicePeriod('9th–24th September 2026')?.start,'2026-09-09')
 assert.equal(suggestInvoicePeriod('Support 9 September 2026')?.end,'2026-09-09')
 assert.equal(suggestInvoicePeriod('Hosting September 2026')?.end,'2026-09-30')
})
test('invoice suggestions accept explicit ISO dates/ranges and reject invalid or mixed periods',()=>{
 assert.equal(suggestInvoicePeriod('Service 2026-09-09 to 2026-09-24')?.end,'2026-09-24')
 assert.equal(suggestInvoicePeriod('Service 2026-09-09 — 2026-09-24')?.start,'2026-09-09')
 assert.equal(suggestInvoicePeriod('2026-09-09')?.end,'2026-09-09')
 for(const text of ['31 September 2026','24–9 September 2026','2026-02-30 to 2026-03-01','9 August–24 September 2026','9 September 2026 and 24 September 2026','September 2026 and 2026-09-09','09/08/2026 to September 2026','Until 24 September 2026','From September 2026']) assert.equal(suggestInvoicePeriod(text),null,text)
})
