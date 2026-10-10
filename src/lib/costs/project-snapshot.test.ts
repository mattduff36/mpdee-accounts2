import test from 'node:test'
import assert from 'node:assert/strict'
import { projectSnapshot } from './project-snapshot'
const date = new Date('2026-09-01T12:00:00Z')
const row = (id = 'one') => ({ event: { id, provider: 'cursor', occurredAt: date, model: 'claude-4.6-sonnet' as string | null }, revision: { id, revision: 1, checksum: id, createdAt: date, funding: 'included', nominalUnits: BigInt(80000), providerUnits: BigInt(0), currency: 'USD', quality: 'complete' }, policy: { id: 'policy', effectiveAt: date, billable: true, includedBaseBps: 6000, markupBps: 0, infrastructureMarkupBps: 0 }, hold: null as string | null, fx: { currency: 'USD', date: '2026-09-01', rate: '1', source: 'test' } })
test('aggregates before pence rounding; stable shuffle and clock', () => {
 const a = projectSnapshot('itrader', [row('a'),row('b')],date), b = projectSnapshot('itrader',[row('b'),row('a')],new Date())
 assert.equal(a.lines[0].amountMinor,1); assert.equal(a.lines[0].sourceUnits,'80000'); assert.equal(a.revision,b.revision)
})
test('source revision, policy and FX affect hash, not stable group ID', () => {
 const a=projectSnapshot('itrader',[row()],date), r=row(); r.policy.markupBps=1000; r.fx.rate='0.8'; r.revision.revision=2
 const b=projectSnapshot('itrader',[r],date); assert.equal(a.lines[0].id,b.lines[0].id); assert.notEqual(a.revision,b.revision)
})
test('holds and missing FX publish no invoiceable money', () => {
 const r=row(); r.hold='review'; const a=projectSnapshot('itrader',[r],date)
 assert.equal(a.lines[0].amountMinor,null); assert.equal(a.lines[0].sourceUnits,null); assert.equal(a.coverage.held,1)
 const b=projectSnapshot('itrader',[{...row(),fx:null}],date); assert.equal(b.lines[0].amountMinor,null); assert.equal(b.coverage.fxMissing,1)
})
test('different FX rates stay one group with final aggregate rounding', () => {
 const a=row('a'),b=row('b'); a.fx.rate='0.8';b.fx.rate='0.9'; const result=projectSnapshot('itrader',[a,b],date)
 assert.equal(result.lines.length,1);assert.equal(result.lines[0].amountMinor,1);assert.equal(result.lines[0].fx.length,2)
})
test('empty, update timestamp, unchanged duplicate import and hard cap', () => {
 const a=projectSnapshot('itrader',[],date,[date,new Date('2026-09-03')]);assert.equal(a.sourceUpdatedAt,'2026-09-03T00:00:00.000Z');assert.deepEqual(a.lines,[])
 assert.equal(a.revision,projectSnapshot('itrader',[],date).revision);assert.throws(()=>projectSnapshot('itrader',Array(50001).fill(row()),date),/50000/)
})
test('provider categories are separate', () => {
 const rows=['cursor','vercel','supabase'].map(provider=>({...row(provider),event:{...row(provider).event,provider}})); const a=projectSnapshot('itrader',rows,date)
 assert.deepEqual(a.lines.map(l=>l.category).sort(),['CURSOR','DATABASE','VERCEL_HOSTING']);assert.equal(JSON.stringify(a).includes('accountRef'),false)
})

import { referenceYears } from './fx-values'
test('historical FX requests every needed year, once', () => {
 assert.deepEqual(referenceYears([new Date('2025-12-31'),new Date('2026-01-01'),new Date('2025-01-01')]),['2025','2026'])
})
test('partial-history namespace is distinct from full history', () => {
 const a=projectSnapshot('itrader',[row()],date),b=projectSnapshot('itrader',[row()],date,[],'2026-08-13T23:00:00.000Z')
 assert.notEqual(a.lines[0].id,b.lines[0].id);assert.notEqual(a.revision,b.revision);assert.equal(b.coverage.from,'2026-08-13T23:00:00.000Z')
})

import { chargeUnits } from './money'
test('fractional policy charges retain exact source-unit parity with the Accounts ledger', () => {
 const rows=Array.from({length:101},(_,i)=>{const r=row(String(i));r.revision.nominalUnits=BigInt(15);r.policy.includedBaseBps=6000;r.policy.markupBps=1000;return r})
 const ledger=rows.reduce((sum,r)=>sum+chargeUnits({provider:r.event.provider,funding:r.revision.funding,nominal:r.revision.nominalUnits,cash:r.revision.providerUnits,model:r.event.model},r.policy)!,BigInt(0))
 const snapshot=projectSnapshot('itrader',rows,date)
 assert.equal(ledger,BigInt(808));assert.equal(snapshot.lines[0].sourceUnits,ledger.toString());assert.equal(snapshot.lines[0].amountMinor,0)
 assert.notEqual(ledger,BigInt(15*101));assert.notEqual(ledger,BigInt(758))
})
test('mixed models use the global rule and a nonbillable policy stays a zero charge', () => {
 const premium=row('premium'), grok=row('grok'), demand=row('demand'), ambiguous=row('ambiguous'), incomplete=row('incomplete')
 grok.event.model='grok-4'
 demand.event.model='composer-2'; demand.revision.funding='on-demand'; demand.revision.nominalUnits=BigInt(160000); demand.revision.providerUnits=BigInt(80000)
 ambiguous.event.model='default'
 incomplete.revision.quality='partial'
 const result=projectSnapshot('itrader',[premium,grok,demand,ambiguous,incomplete],date)
 const included=result.lines.find(line=>line.funding==='included'&&!line.held)
 assert.equal(included?.sourceUnits,'40000'); assert.equal(included?.events,2)
 const onDemand=result.lines.find(line=>line.funding==='on-demand')
 assert.equal(onDemand?.held,false); assert.equal(onDemand?.sourceUnits,'80000')
 const held=result.lines.filter(line=>line.held)
 assert.equal(held.reduce((sum,line)=>sum+line.events,0),2)
 assert.ok(held.every(line=>line.sourceUnits===null&&line.amountMinor===null))
 const quiet=row('quiet'); quiet.policy.billable=false
 const zero=projectSnapshot('itrader',[quiet],date)
 assert.equal(zero.lines[0].held,false); assert.equal(zero.lines[0].sourceUnits,'0'); assert.equal(zero.coverage.held,0)
})
