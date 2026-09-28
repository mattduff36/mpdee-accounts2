import test from 'node:test'
import assert from 'node:assert/strict'
import {collectorStatusSchema,cursorAccounts,collectorRunHealth,recoveredCompleteDay} from './collector-status'
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

const activeReport=()=>({...report(),mode:'active_account',activeAccount:cursorAccounts[0],accounts:report().accounts.map((account,i)=>({...account,state:i===0?'success':'inactive',catchingUp:i!==0}))})
test('active-account mode preserves inactive histories without treating them as failures',()=>{
 const parsed=collectorStatusSchema.parse(activeReport())
 const health=collectorRunHealth(parsed,Date.parse(parsed.finishedAt))
 assert.equal(health.activeMode,true)
 assert.equal(health.healthy,true)
 assert.equal(health.catchingUp,false)
 assert.equal(parsed.accounts.filter(a=>a.state==='inactive').length,3)
})

test('active mode requires every other account inactive and no successes without an active account',()=>{
 const base=activeReport()
 assert.equal(collectorStatusSchema.safeParse({...base,activeAccount:undefined}).success,false)
 assert.equal(collectorStatusSchema.safeParse({...base,accounts:base.accounts.map((a,i)=>i===1?{...a,state:'missing_session'}:a)}).success,false)
 assert.equal(collectorStatusSchema.safeParse({...base,succeeded:2,accounts:base.accounts.map((a,i)=>i===1?{...a,state:'success',accountRef:'b'.repeat(32)}:a)}).success,false)
 assert.equal(collectorStatusSchema.safeParse({...base,mode:undefined}).success,false)
 assert.equal(collectorStatusSchema.safeParse({...report(),activeAccount:cursorAccounts[0]}).success,false)
 const none=collectorStatusSchema.parse({...base,activeAccount:undefined,succeeded:0,accounts:base.accounts.map(a=>({...a,state:'inactive'}))})
 assert.equal(collectorRunHealth(none,Date.parse(none.finishedAt)).healthy,false)
 assert.equal(collectorRunHealth(none,Date.parse(none.finishedAt)).active,undefined)
})

test('active mode health requires successful fresh collection and upload without catch-up',()=>{
 const parsed=collectorStatusSchema.parse(activeReport())
 const now=Date.parse(parsed.finishedAt)
 assert.equal(collectorRunHealth({...parsed,uploadState:'failed'},now).healthy,false)
 assert.equal(collectorRunHealth(parsed,now+4*3600000).healthy,false)
 assert.equal(collectorRunHealth({...parsed,accounts:parsed.accounts.map((a,i)=>i===0?{...a,catchingUp:true}:a)},now).healthy,false)
 const failed=collectorStatusSchema.parse({...parsed,succeeded:0,accounts:parsed.accounts.map((a,i)=>i===0?{...a,state:'identity_unverified'}:a)})
 assert.equal(collectorRunHealth(failed,now).healthy,false)
})

test('recovered complete days stop before the exclusive UTC boundary',()=>{
 assert.equal(recoveredCompleteDay('2026-09-28T00:00:00.000Z'),'2026-09-27')
 assert.equal(recoveredCompleteDay('2026-10-01T00:00:00.000Z'),'2026-09-30')
 assert.equal(recoveredCompleteDay('2026-09-28T14:30:00.000Z'),'2026-09-27')
})
