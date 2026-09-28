import test from 'node:test'
import assert from 'node:assert/strict'
import { suggestProject, reviewGroupKey, type AttributionEvent } from './attribution'
const event: AttributionEvent = { id:'1', accountRef:'account',provider:'cursor',conversationId:'conversation',workspaceRef:null,occurredAt:new Date('2026-09-28T10:00:00Z'),projectId:null }
test('timing remains weak and tied evidence does not recommend a project', () => {
  const near = { ...event, id:'2', conversationId:'different',projectId:'a' }
  assert.equal(suggestProject(event,[near]).suggestion?.score,35)
  assert.equal(suggestProject(event,[near,{...near,projectId:'b'}]).suggestion,null)
})
test('exact conversation wins; other accounts are excluded', () => {
  assert.equal(suggestProject(event,[{...event,projectId:'a'}]).suggestion?.score,95)
  assert.equal(suggestProject(event,[{...event,accountRef:'other',projectId:'a'}]).suggestion,null)
  assert.notEqual(reviewGroupKey(event),reviewGroupKey({...event,accountRef:'other'}))
})
