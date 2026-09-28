import test from 'node:test'
import assert from 'node:assert/strict'
import {collectorStatusSchema,cursorAccounts} from './collector-status'
const report=()=>({version:1,expected:4,succeeded:1,finishedAt:'2026-09-28T10:00:00.000Z',uploadState:'success',accounts:cursorAccounts.map((email,i)=>({email,startedAt:'2026-09-28T09:59:00.000Z',finishedAt:'2026-09-28T10:00:00.000Z',state:i===0?'success':'missing_session',...(i===0?{accountRef:'a'.repeat(32)}:{})}))})
test('partial four-account coverage is valid and remains partial',()=>{const r=collectorStatusSchema.parse(report());assert.equal(r.succeeded,1);assert.equal(r.accounts.filter(a=>a.state==='missing_session').length,3)})
test('collector report rejects omitted, duplicated and inflated account coverage',()=>{
 let r=report();r.accounts.pop();assert.equal(collectorStatusSchema.safeParse(r).success,false)
 r=report();r.accounts[1].email=r.accounts[0].email;assert.equal(collectorStatusSchema.safeParse(r).success,false)
 r=report();r.succeeded=4;assert.equal(collectorStatusSchema.safeParse(r).success,false)
})
test('collector health refuses secret fields and reused account identities',()=>{
 assert.equal(collectorStatusSchema.safeParse({...report(),cookie:'must-not-be-persisted'}).success,false)
 const r=report();r.accounts[1]={...r.accounts[1],state:'success',accountRef:'a'.repeat(32)};r.succeeded=2;assert.equal(collectorStatusSchema.safeParse(r).success,false)
})

test('collector accepts optional recovery facts without inflating health',()=>{
 const original=report()
 const parsed=collectorStatusSchema.parse({...original,lastUploadSuccessAt:'2026-09-27T10:00:00.000Z',accounts:original.accounts.map((account,i)=>({...account,lastSuccessAt:'2026-09-26T10:00:00.000Z',coveredThrough:'2026-09-25T00:00:00.000Z',catchingUp:i===0}))})
 assert.equal(parsed.succeeded,1)
 assert.equal(parsed.accounts[0].catchingUp,true)
 assert.equal(parsed.accounts[1].state,'missing_session')
 assert.equal(parsed.accounts[1].lastSuccessAt,'2026-09-26T10:00:00.000Z')
 assert.equal(parsed.lastUploadSuccessAt,'2026-09-27T10:00:00.000Z')
})

test('recovery fields reject invalid dates, types and unknown secret fields',()=>{
 const original=report()
 for(const extra of [{lastSuccessAt:'yesterday'},{coveredThrough:'yesterday'},{catchingUp:'true'},{cookie:'private'},{credentials:{token:'private'}}]){
  assert.equal(collectorStatusSchema.safeParse({...original,accounts:original.accounts.map((account,i)=>i===0?{...account,...extra}:account)}).success,false)
 }
 assert.equal(collectorStatusSchema.safeParse({...original,lastUploadSuccessAt:'yesterday'}).success,false)
 assert.equal(collectorStatusSchema.safeParse({...original,lastUploadSuccessAt:'2026-09-28T10:00:00.000Z',token:'private'}).success,false)
})
