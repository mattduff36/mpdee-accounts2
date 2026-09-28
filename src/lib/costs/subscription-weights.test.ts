import test from 'node:test'
import assert from 'node:assert/strict'
import { subscriptionWeights } from './subscription-weights'
import { splitPence } from './profitability'

const event = (projectId: string | null, funding = 'included', nominalUnits: bigint | null = BigInt(100), quality = 'complete', currency = 'USD') => ({ projectId, revisions: [{ funding, nominalUnits, quality, currency }] })

test('unknown funding and missing revisions cannot disappear when selecting included weights', () => {
  assert.throws(() => subscriptionWeights([event('project'), event(null, 'unknown')]), /unresolved funding/)
  assert.throws(() => subscriptionWeights([event('project'), {projectId:null,revisions:[]}]), /no monetary revision/)
  assert.throws(() => subscriptionWeights([event('project'), event(null, 'future-provider-label')]), /unresolved funding/)
})

test('included missing values, held values, negative weights and mixed currencies still block allocation', () => {
  assert.throws(() => subscriptionWeights([event(null, 'included', null)]), /monetary review/)
  assert.throws(() => subscriptionWeights([event(null, 'included', BigInt(100), 'review')]), /monetary review/)
  assert.throws(() => subscriptionWeights([event(null, 'included', BigInt(-1))]), /monetary review/)
  assert.throws(() => subscriptionWeights([event('one'), event('two', 'included', BigInt(100), 'complete', 'GBP')]), /Mixed source currencies/)
})

test('recognized on-demand monetary review is excluded without blocking complete included weights', () => {
  const {included,weights}=subscriptionWeights([event('project'),event('other','on-demand',null,'review','EUR')])
  assert.equal(included.length,1)
  assert.deepEqual(Array.from(weights),[['project',BigInt(100)]])
})

test('unassigned and internal usage retain their shares with exact pence conservation', () => {
  const {weights}=subscriptionWeights([event('client', 'included', BigInt(200)),event(null),event('internal')])
  const shares=splitPence(1000,Array.from(weights).map(([id,weight])=>({id,weight})))
  assert.equal(shares.get('client'),500)
  assert.equal(shares.get('unassigned'),250)
  assert.equal(shares.get('internal'),250)
  assert.equal(Array.from(shares.values()).reduce((sum,value)=>sum+value,0),1000)
})

test('empty, excessive and on-demand-only windows refuse subscription allocation', () => {
  assert.throws(()=>subscriptionWeights([]),/usable usage window/)
  assert.throws(()=>subscriptionWeights(Array.from({length:50001},()=>event('project'))),/usable usage window/)
  assert.throws(()=>subscriptionWeights([event('project','on-demand')]),/No included usage/)
})
