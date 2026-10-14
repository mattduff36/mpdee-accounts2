import assert from 'node:assert/strict'
import { test } from 'node:test'
import { prisma } from '@/lib/db'
import { importSchema, normalize } from './normalize'
import { MANUAL_SPLIT_MARKER, splitBigint } from './split-units'
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
    // Enrichment changes evidence once; an older outbox replay retains it unchanged.
    const freshEvent={...event,conversationId:'context-conversation'}
    const context={method:'local-topic-rules-v1',topics:['Database work']}
    await importUsage({...payload,events:[{...freshEvent,taskContext:context}]})
    const contextRecord=events.find(e=>e.conversationId==='context-conversation')
    const beforeContextRevisions=revisions.filter(r=>r.eventId===contextRecord.id).length
    r=await importUsage({...payload,events:[freshEvent]})
    assert.equal(r.duplicate,1)
    assert.equal(revisions.filter(r=>r.eventId===contextRecord.id).length,beforeContextRevisions)
    // A genuine monetary correction still revises, preserving the context.
    r=await importUsage({...payload,events:[{...freshEvent,chargedCents:'300'}]})
    assert.equal(r.revised,1)
    assert.deepEqual(revisions.filter(r=>r.eventId===contextRecord.id).at(-1).evidence.taskContext,context)

    // A legacy outbox cannot erase reviewed invoice coverage and make evidence billable again.
    const infra = { timestamp:'2026-09-01T00:00:00.000Z', sourceId:'coverage-proof', billedAmount:'2.00', currency:'GBP' }
    const infraPayload = { provider:'vercel', accountRef:'coverage-account', quality:'complete' }
    await importUsage({...infraPayload,events:[{...infra,coveredByProviderInvoice:true}]})
    const coveredRecord=events.find(e=>e.sourceKey==='coverage-proof:0')
    const coverageRevisionCount=revisions.filter(r=>r.eventId===coveredRecord.id).length
    r=await importUsage({...infraPayload,events:[infra]})
    assert.equal(r.duplicate,1,'omitted coverage retains the prior reviewed value')
    assert.equal(revisions.filter(r=>r.eventId===coveredRecord.id).length,coverageRevisionCount)
    assert.equal(revisions.filter(r=>r.eventId===coveredRecord.id).at(-1).evidence.coveredByProviderInvoice,true)
    r=await importUsage({...infraPayload,events:[{...infra,coveredByProviderInvoice:false}]})
    assert.equal(r.revised,1,'an explicit false is a reviewable correction')
    assert.equal(revisions.filter(r=>r.eventId===coveredRecord.id).at(-1).evidence.coveredByProviderInvoice,false)
    r=await importUsage({...infraPayload,events:[{...infra,taskContext:context}]})
    assert.equal(r.revised,1,'new context may enrich without losing invoice coverage')
    assert.equal(revisions.filter(r=>r.eventId===coveredRecord.id).at(-1).evidence.coveredByProviderInvoice,false)

  } finally { prisma.$transaction=original }
})

test('a manual equal split survives replay and a correction is divided again', async () => {
  const events: any[] = [], revisions: any[] = []
  const tx = {
    $executeRaw: async () => 1,
    costProjectMapping: { findMany: async () => [] },
    costUsageEvent: {
      findMany: async () => events.map(event => ({ ...event, revisions: revisions.filter(revision => revision.eventId === event.id).sort((a, b) => b.revision - a.revision).slice(0, 1) })),
      createMany: async ({ data }: any) => { events.push(...data); return { count: data.length } },
      update: async ({ where, data }: any) => { const event = events.find(item => item.id === where.id); Object.assign(event, data); event.occurredAt = new Date(event.occurredAt); return event },
    },
    costUsageRevision: { createMany: async ({ data }: any) => { revisions.push(...data); return { count: data.length } } },
    costImportRun: { create: async ({ data }: any) => ({ id: 'run', ...data }) },
    auditLog: { create: async () => ({}) },
  }
  const original = prisma.$transaction
  ;(prisma as any).$transaction = async (fn: any) => fn(tx)
  const event = { timestamp: '2026-09-26T10:00:00Z', model: 'test-model', conversationId: 'conversation', kind: 'USAGE_EVENT_KIND_USAGE_BASED', chargedCents: '100', isTokenBasedCall: true, tokenUsage: { totalCents: '100' } }
  const payload = { provider: 'cursor' as const, accountRef: 'test-account', quality: 'complete' as const, events: [event] }
  const latest = (id: string) => revisions.filter(revision => revision.eventId === id).sort((a, b) => b.revision - a.revision)[0]
  try {
    await importUsage(payload)
    const anchor = events[0]
    const fullNominal = latest(anchor.id).nominalUnits as bigint
    const fullCash = latest(anchor.id).providerUnits as bigint
    const projectA = 'project-a', projectB = 'project-b'
    const nominalShares = splitBigint(fullNominal, [projectA, projectB])
    const cashShares = splitBigint(fullCash, [projectA, projectB])
    anchor.projectId = projectA
    anchor.attribution = 'manual'
    anchor.manualAssignment = true
    latest(anchor.id).nominalUnits = nominalShares.get(projectA)
    latest(anchor.id).providerUnits = cashShares.get(projectA)
    const sibling = { ...anchor, id: 'sibling', sourceKey: `${anchor.sourceKey}${MANUAL_SPLIT_MARKER}${projectB}`, projectId: projectB }
    events.push(sibling)
    revisions.push({ ...latest(anchor.id), eventId: sibling.id, revision: 1, nominalUnits: nominalShares.get(projectB), providerUnits: cashShares.get(projectB) })
    const before = revisions.length
    const replay = await importUsage(payload)
    assert.equal(replay.duplicate, 1)
    assert.equal(revisions.length, before)
    const corrected = { ...payload, events: [{ ...event, chargedCents: '200', tokenUsage: { totalCents: '200' } }] }
    const revision = await importUsage(corrected)
    assert.equal(revision.revised, 1)
    const expected = normalize(importSchema.parse(corrected))[0]
    assert.equal(latest(anchor.id).nominalUnits + latest(sibling.id).nominalUnits, expected.nominal)
    assert.equal(latest(anchor.id).providerUnits + latest(sibling.id).providerUnits, expected.cash)
    assert.notEqual(latest(anchor.id).nominalUnits, expected.nominal)
    assert.equal(latest(sibling.id).evidence.manualSplitOf, anchor.sourceKey)
  } finally { prisma.$transaction = original }
})

test('duplicate infrastructure sourceId and membership fail before any persistence', async () => {
  const writes: string[] = []
  let entered = 0
  const original = prisma.$transaction
  ;(prisma as any).$transaction = async (fn: any) => { entered++; return fn({ costUsageEvent: { createMany: async () => { writes.push('event') } }, costUsageRevision: { createMany: async () => { writes.push('revision') } } }) }
  const line = { timestamp: '2026-09-01T00:00:00.000Z', sourceId: 'line-1', billedAmount: '1.00', currency: 'USD' }
  try {
    await assert.rejects(() => importUsage({ provider: 'vercel', accountRef: 'team-test', quality: 'complete', events: [line, { ...line, timestamp: '2026-09-02T00:00:00.000Z', billedAmount: '2.00' }] }), /Repeated infrastructure sourceId/)
    await assert.rejects(() => importUsage({ provider: 'vercel', accountRef: 'team-test', quality: 'complete', events: [{ timestamp: '2026-09-01T00:00:00.000Z', sourceId: 'vercel:membership:2026-09-01', billedAmount: '0.38', currency: 'GBP' }] }), /membership sourceId/)
    assert.equal(entered, 0)
    assert.deepEqual(writes, [])
  } finally { prisma.$transaction = original }
})
