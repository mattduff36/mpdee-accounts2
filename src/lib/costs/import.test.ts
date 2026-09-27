import assert from 'node:assert/strict'
import { test } from 'node:test'
import { prisma } from '@/lib/db'
import { importUsage } from './service'

// Exercise import/revision decisions with a transaction double. Live Postgres migration
// and concurrency verification remain an explicit preview deployment gate.
test('import replay, correction, enrichment, manual attribution and collision holds', async () => {
  const events: any[] = [], revisions: any[] = [], mappings: any[] = []
  let locks=0
  const tx = {
    $executeRaw: async () => {locks++;return 1},
    costProjectMapping:{findMany:async()=>mappings},
    costUsageEvent:{
      findMany:async()=>events.map(e=>({...e,revisions:revisions.filter(r=>r.eventId===e.id).sort((a,b)=>b.revision-a.revision).slice(0,1)})),
      createMany:async({data}:any)=>{events.push(...data);return {count:data.length}},
      update:async({where,data}:any)=>{const e=events.find(e=>e.id===where.id);Object.assign(e,data);e.occurredAt=new Date(e.occurredAt);return e},
    },
    costUsageRevision:{createMany:async({data}:any)=>{revisions.push(...data);return {count:data.length}}},
    costImportRun:{create:async({data}:any)=>({id:'run',...data})},
    auditLog:{create:async()=>({})},
  }
  const original = prisma.$transaction
  ;(prisma as any).$transaction=async(fn:any)=>fn(tx)
  const event={timestamp:'2026-09-26T10:00:00Z',model:'test-model',conversationId:'conversation',kind:'USAGE_EVENT_KIND_USAGE_BASED',chargedCents:'100',isTokenBasedCall:true,tokenUsage:{totalCents:'100'}}
  const payload={provider:'cursor',accountRef:'test-account',quality:'complete',events:[event]}
  try {
    let r=await importUsage(payload)
    assert.equal(r.added,1);assert.equal(r.unassigned,1);assert.equal(revisions.length,1)
    r=await importUsage(payload)
    assert.equal(r.duplicate,1);assert.equal(events.length,1);assert.equal(revisions.length,1)
    r=await importUsage({...payload,events:[{...event,chargedCents:'200',tokenUsage:{totalCents:'200'}}]})
    assert.equal(r.revised,1);assert.equal(revisions.length,2);assert.equal(events.length,1)
    mappings.push({type:'workspace',value:'workspace-one',projectId:'project-one'})
    r=await importUsage({...payload,events:[{...event,workspaceRef:'workspace-one'}]})
    assert.equal(events[0].projectId,'project-one');assert.equal(r.unassigned,0)
    await importUsage(payload)
    assert.equal(events[0].projectId,'project-one','missing hints preserve mapping')
    events[0].manualAssignment=true;events[0].projectId='manual-project'
    await importUsage({...payload,events:[{...event,workspaceRef:'workspace-one'}]})
    assert.equal(events[0].projectId,'manual-project')
    await importUsage({...payload,events:[event,event]})
    assert.equal(events.length,2)
    await importUsage(payload)
    assert.equal(revisions.filter(r=>r.eventId===events[0].id).at(-1).quality,'review','smaller windows must not clear ambiguity')
    assert.equal(locks,8)
  } finally { prisma.$transaction=original }
})
