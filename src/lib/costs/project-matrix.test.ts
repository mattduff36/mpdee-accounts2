import test from 'node:test'
import assert from 'node:assert/strict'
import { mappedProject, policyData, matrixSchema, verifiedLocalConnections, rangesOverlap, parseUtcDate, coverageEnd } from './project-matrix'
const event={accountRef:'account',conversationId:'thread',workspaceRef:'workspace',resourceRef:null,provider:'cursor',projectId:null,attribution:'unassigned',manualAssignment:false}
test('matrix applies exact evidence and retains manual assignments and existing conflicts',()=>{
  const maps=[{type:'workspace',value:'workspace',projectId:'one'}]
  assert.deepEqual(mappedProject(event,maps),{projectId:'one',attribution:'mapped'})
  assert.equal(mappedProject({...event,manualAssignment:true},maps),null)
  assert.equal(mappedProject({...event,attribution:'conflict'},maps),null)
  assert.equal(mappedProject({...event,workspaceRef:'different'},maps),null)
  assert.equal(mappedProject({...event,workspaceRef:null},[{type:'workspace',value:'null',projectId:'one'}]),null)
})
test('contradictory source mappings and different prior attribution are held',()=>{
  assert.deepEqual(mappedProject(event,[{type:'workspace',value:'workspace',projectId:'one'},{type:'conversation',value:'account/thread',projectId:'two'}]),{projectId:null,attribution:'conflict'})
  assert.deepEqual(mappedProject({...event,projectId:'old'},[{type:'workspace',value:'workspace',projectId:'one'}]),{projectId:null,attribution:'conflict'})
  assert.equal(mappedProject(event,[{type:'conversation',value:'other/thread',projectId:'two'}]),null)
})
test('rates preserve percentage-point semantics and reject invalid date/base',()=>{
  const input={effectiveAt:'2026-09-01',billable:true,includedBase:'50',markup:'10',infrastructureMarkup:'0'}
  const result=policyData(input)
  assert.equal(result.includedBaseBps+result.markupBps,6000)
  assert.equal(result.vercelDailyPence,0)
  assert.equal(result.effectiveUntil,null)
  assert.equal(result.effectiveAt.toISOString(),'2026-09-01T00:00:00.000Z')
  assert.equal(policyData({...input,effectiveUntil:'2026-09-30',vercelDaily:'0.38'}).vercelDailyPence,38)
  assert.throws(()=>policyData({...input,effectiveAt:'2026-02-30'}))
  assert.throws(()=>policyData({...input,includedBase:'101'}))
  assert.throws(()=>policyData({...input,markup:'-1'}))
  assert.throws(()=>policyData({...input,effectiveUntil:'2026-08-01'}))
  assert.throws(()=>policyData({...input,vercelDaily:'-1'}))
})
test('open ranges stop before the next rate and explicit ends cannot cross it',()=>{
  const first={effectiveAt:parseUtcDate('2026-08-01'),effectiveUntil:null}
  const next={effectiveAt:parseUtcDate('2026-09-28'),effectiveUntil:null}
  assert.equal(rangesOverlap([first,next]),false)
  assert.equal(coverageEnd(first,[first,next])?.toISOString().slice(0,10),'2026-09-27')
  assert.equal(coverageEnd(next,[first,next]),null)
  assert.equal(rangesOverlap([first,{...next,effectiveUntil:parseUtcDate('2026-10-02')}, {effectiveAt:parseUtcDate('2026-10-01'),effectiveUntil:null}]),true)
  assert.equal(rangesOverlap([{effectiveAt:parseUtcDate('2026-08-01'),effectiveUntil:parseUtcDate('2026-08-10')},{effectiveAt:parseUtcDate('2026-08-10'),effectiveUntil:null}]),true)
})
test('matrix rejects unsupported mapping kinds and overlong values',()=>{
  const row={id:'one',clientId:null,repository:null,previousClientId:null,previousRepository:null,policy:null,mappings:[]}
  assert.equal(matrixSchema.safeParse({projects:[row],clients:[]}).success,true)
  assert.equal(matrixSchema.safeParse({projects:[{...row,mappings:[{type:'guessed',value:'x'}]}],clients:[]}).success,false)
})

test('verified local connections require unique corroborated identities and never overwrite conflicts',()=>{
  const project={id:'one',name:'shop',slug:'vercel-shop',repository:null,mappings:[]}
  const local={name:'shop',repository:'mattduff36/shop',workspaceRef:'d-Websites-shop',vercelProjectId:'prj_shop'}
  assert.equal(verifiedLocalConnections([project],[local]).length,1)
  assert.equal(verifiedLocalConnections([project,{...project,id:'two'}],[local]).length,0)
  assert.equal(verifiedLocalConnections([project],[{...local,repository:'mattduff36/different'}]).length,0)
  assert.equal(verifiedLocalConnections([{...project,repository:'mattduff36/other'}],[local]).length,0)
  assert.equal(verifiedLocalConnections([project,{...project,id:'two',name:'other',slug:'other',mappings:[{type:'workspace',value:local.workspaceRef}]}],[local]).length,0)
  assert.equal(verifiedLocalConnections([{...project,name:'Friendly shop name',slug:'internal-shop',mappings:[{type:'vercel-resource',value:'prj_shop'}]}],[local]).length,1)
})
