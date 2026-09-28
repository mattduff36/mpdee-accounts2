import test from 'node:test'
import assert from 'node:assert/strict'
import { importSchema, normalize } from './normalize'
const raw = {provider:'cursor',accountRef:'test-account',quality:'complete',events:[{timestamp:'2026-09-28T10:00:00Z',kind:'USAGE_EVENT_KIND_INCLUDED_IN_ULTRA',model:'test',conversationId:'test',tokenUsage:{totalCents:100}}]}
test('sanitized task context changes evidence but never usage identity or money',()=>{
  const before=normalize(importSchema.parse(raw))[0]
  const after=normalize(importSchema.parse({...raw,events:[{...raw.events[0],taskContext:{method:'local-topic-rules-v1',topics:['Database work']}}]}))[0]
  assert.equal(before.sourceKey,after.sourceKey)
  assert.equal(before.nominal,after.nominal)
  assert.notEqual(before.checksum,after.checksum)
  assert.deepEqual(after.evidence.taskContext,{method:'local-topic-rules-v1',topics:['Database work']})
})
test('context accepts fixed vocabulary only and rejects raw prompt fields',()=>{
  for(const taskContext of [{method:'local-topic-rules-v1',topics:['password=secret']},{method:'local-topic-rules-v1',topics:[],prompt:'private'}]) assert.equal(importSchema.safeParse({...raw,events:[{...raw.events[0],taskContext}]}).success,false)
})
