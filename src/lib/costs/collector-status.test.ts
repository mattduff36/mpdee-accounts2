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
