import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAssignmentIndex, reviewGroupKey, suggestFromIndex, suggestProject, type AttributionEvent } from './attribution'
const event: AttributionEvent = { id:'1', accountRef:'account',provider:'cursor',conversationId:'conversation',workspaceRef:null,occurredAt:new Date('2026-09-28T10:00:00Z'),projectId:null }
test('timing remains weak and tied evidence does not recommend a project', () => {
  const near = { ...event, id:'2', conversationId:'different',projectId:'a' }
  assert.equal(suggestProject(event,[near]).suggestion?.score,35)
  assert.equal(suggestProject(event,[near,{...near,projectId:'b'}]).suggestion,null)
})
test('indexed suggestions match a full neighbour scan, including the 30-minute boundary', () => {
  const base = new Date('2026-06-01T00:00:00Z').getTime()
  const events: AttributionEvent[] = []
  for (let i = 0; i < 40; i++) {
    events.push({
      id: `e${i}`, accountRef: i % 5 === 0 ? 'other' : 'account', provider: i % 7 === 0 ? 'vercel' : 'cursor',
      conversationId: i % 4 === 0 ? null : `c${i % 6}`, workspaceRef: i % 3 === 0 ? null : `w${i % 5}`,
      occurredAt: new Date(base + i * 10 * 60 * 1000), projectId: i % 2 === 0 ? (i % 4 === 0 ? 'a' : 'b') : null,
    })
  }
  events.push({ id: 'edge', accountRef: 'account', provider: 'cursor', conversationId: 'nope', workspaceRef: null, occurredAt: new Date(base + 30 * 60 * 1000), projectId: 'edge-project' })
  events.push({ id: 'over', accountRef: 'account', provider: 'cursor', conversationId: 'nope', workspaceRef: null, occurredAt: new Date(base + 30 * 60 * 1000 + 1), projectId: 'late-project' })
  const index = buildAssignmentIndex(events)
  for (const target of [
    { id: 't', accountRef: 'account', provider: 'cursor', conversationId: 'c1', workspaceRef: 'w1', occurredAt: new Date(base), projectId: null },
    { id: 'timing', accountRef: 'account', provider: 'cursor', conversationId: null, workspaceRef: null, occurredAt: new Date(base), projectId: null },
    { id: 'none', accountRef: 'missing', provider: 'cursor', conversationId: 'c1', workspaceRef: 'w1', occurredAt: new Date(base), projectId: null },
  ]) {
    assert.deepEqual(suggestFromIndex(target, index), suggestProject(target, events))
  }
})
test('exact conversation wins; other accounts are excluded', () => {
  assert.equal(suggestProject(event,[{...event,projectId:'a'}]).suggestion?.score,95)
  assert.equal(suggestProject(event,[{...event,accountRef:'other',projectId:'a'}]).suggestion,null)
  assert.notEqual(reviewGroupKey(event),reviewGroupKey({...event,accountRef:'other'}))
})
