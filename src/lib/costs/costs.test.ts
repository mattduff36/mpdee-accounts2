import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decimalUnits, unitsText, chargeUnits, gbpPence, percentBps, CHARGE_RULE_VERSION, isGrokOrComposerFamily } from './money'
import { importSchema, normalize } from './normalize'
import { validIngestToken } from './machine-auth'
import { resolvePolicy, monthRange } from './service'
const policy = { billable: true, includedBaseBps: 5000, markupBps: 1000, infrastructureMarkupBps: 0 }
const raw = { timestamp: '2026-09-26T15:36:24.000Z', model: 'example', conversationId: 'conversation-1', isTokenBasedCall: true, kind: 'USAGE_EVENT_KIND_USAGE_BASED', chargedCents: 233.65, usageBasedCosts: '2.34', cursorTokenFee: 0, tokenUsage: { inputTokens: 21, outputTokens: 3591, cacheReadTokens: 915305, cacheWriteTokens: 379699, totalCents: 233.65 } }
const input = (events: unknown[], quality = 'complete') => importSchema.parse({ provider: 'cursor', accountRef: 'test-account', quality, events })
test('included premium usage is half nominal and on-demand is cash, ignoring saved markups', () => {
  const model = 'claude-4.6-sonnet'
  assert.equal(unitsText(chargeUnits({ provider: 'cursor',funding:'included',nominal:decimalUnits('10'),cash:BigInt(0),model },policy)!), '5.0000000')
  assert.equal(unitsText(chargeUnits({ provider: 'cursor',funding:'on-demand',nominal:decimalUnits('10'),cash:decimalUnits('10'),model },policy)!), '10.0000000')
  assert.equal(unitsText(chargeUnits({ provider: 'vercel',funding:'infrastructure',nominal:null,cash:decimalUnits('10') },policy)!), '10.0000000')
  assert.equal(chargeUnits({ provider:'cursor',funding:'unknown',nominal:null,cash:null,model },policy),null)
  assert.equal(chargeUnits({ provider:'cursor',funding:'included',nominal:decimalUnits('10'),cash:BigInt(0),model },{...policy,billable:false}),BigInt(0))
})
test('precise cents differ from rounded display dollars and are retained', () => {
  const [event] = normalize(input([raw]))
  assert.equal(unitsText(event.cash!), '2.3365000')
  assert.equal(event.quality,'complete')
  assert.equal(unitsText(chargeUnits({provider:'cursor',...event,model:'claude-4.6-sonnet'},policy)!), '2.3365000')
  assert.equal(decimalUnits('0.00000005'),BigInt(1))
  assert.equal(gbpPence(decimalUnits('2.3365'),'0.75'),BigInt(175))
  assert.equal(percentBps('12.35'),1235)
  assert.throws(()=>decimalUnits('NaN'))
})
test('included cost is nominal value, never provider cash, and isChargeable is ignored', () => {
  const [event] = normalize(input([{...raw,kind:'USAGE_EVENT_KIND_INCLUDED_IN_ULTRA',isChargeable:true}]))
  assert.equal(event.cash,BigInt(0))
  assert.equal(event.nominal,decimalUnits('2.3365'))
  assert.equal(event.funding,'included')
})
test('unknown labels, fees, missing amounts and duplicate identities are held for review', () => {
  for (const patch of [{kind:'new-funding-label'}, {cursorTokenFee:1}, {tokenUsage:null}]) assert.equal(normalize(input([{...raw,...patch}]))[0].quality,'review')
  const collision = normalize(input([raw,{...raw,chargedCents:234}]))
  assert.equal(collision.length,2)
  assert.notEqual(collision[0].sourceKey,collision[1].sourceKey)
  assert.ok(collision.every(e=>e.quality==='review'))
  assert.equal(normalize(input([raw],'partial'))[0].quality,'partial')
})
test('provider corrections retain identity and change revision checksum', () => {
  const old = normalize(input([raw]))[0]
  const update = normalize(input([{...raw,kind:'USAGE_EVENT_KIND_INCLUDED_IN_ULTRA',chargedCents:240}]))[0]
  assert.equal(old.sourceKey,update.sourceKey)
  assert.notEqual(old.checksum,update.checksum)
})
test('auth/account identifiers outside the allowed event schema never enter evidence', () => {
  const [event] = normalize(input([{...raw,owningUser:123,accessToken:'SECRET',cookie:'SECRET',arbitrary:'SECRET'}]))
  assert.ok(!JSON.stringify(event.evidence).includes('SECRET'))
  assert.ok(!('owningUser' in event.evidence))
})
test('infrastructure needs stable IDs and keeps credits negative', () => {
  assert.throws(()=>normalize(importSchema.parse({provider:'vercel',accountRef:'team-test',events:[{timestamp:raw.timestamp,billedAmount:'1'}]})))
  const [event] = normalize(importSchema.parse({provider:'vercel',accountRef:'team-test',quality:'complete',events:[{timestamp:raw.timestamp,sourceId:'invoice-line-1',billedAmount:'-1.25',currency:'GBP'}]}))
  assert.equal(event.cash,decimalUnits('-1.25')); assert.equal(event.fxGbp,'1')
})
test('write token fails closed when missing, short or mismatched', () => {
  const secret='a'.repeat(40)
  assert.equal(validIngestToken(`Bearer ${secret}`,secret),true)
  assert.equal(validIngestToken(`Bearer ${secret}`,undefined),false)
  assert.equal(validIngestToken('Bearer short','short'),false)
  assert.equal(validIngestToken(`Bearer ${'b'.repeat(40)}`,secret),false)
  assert.equal(validIngestToken(null,secret),false)
})
test('effective-date project override wins over client defaults, future rates do not rewrite history', () => {
  const p = [
    {...policy,id:'client',projectId:null,clientId:'c',effectiveAt:new Date('2026-01-01'),markupBps:1500},
    {...policy,id:'project',projectId:'p',clientId:null,effectiveAt:new Date('2026-09-01')},
    {...policy,id:'future',projectId:'p',clientId:null,effectiveAt:new Date('2026-10-01'),markupBps:2000},
  ]
  assert.equal(resolvePolicy(p,'p','c',new Date('2026-08-01'))?.id,'client')
  assert.equal(resolvePolicy(p,'p','c',new Date('2026-09-26'))?.id,'project')
  assert.equal(resolvePolicy(p,'p','c',new Date('2026-10-01'))?.id,'future')
  assert.equal(resolvePolicy(p,'other',null,new Date('2026-09-26')),null)
  const closed = [
    {...policy,id:'open',projectId:'p',clientId:null,effectiveAt:new Date('2026-08-01T00:00:00.000Z'),effectiveUntil:null},
    {...policy,id:'limited',projectId:'p',clientId:null,effectiveAt:new Date('2026-09-01T00:00:00.000Z'),effectiveUntil:new Date('2026-09-10T00:00:00.000Z')},
  ]
  assert.equal(resolvePolicy(closed,'p',null,new Date('2026-08-15T12:00:00.000Z'))?.id,'open')
  assert.equal(resolvePolicy(closed,'p',null,new Date('2026-09-10T18:00:00.000Z'))?.id,'limited')
  assert.equal(resolvePolicy(closed,'p',null,new Date('2026-09-11T00:00:00.000Z')),null)
  assert.equal(resolvePolicy([{...policy,id:'client',projectId:null,clientId:'c',effectiveAt:new Date('2026-01-01')},...closed],'p','c',new Date('2026-09-11T00:00:00.000Z'))?.id,'client')
  assert.equal(monthRange('2026-12').end.toISOString(),'2027-01-01T00:00:00.000Z')
})

test('historical Pro and Pro Plus included labels use precise nominal value and zero per-request cash', () => {
  for (const kind of ['USAGE_EVENT_KIND_INCLUDED_IN_PRO','USAGE_EVENT_KIND_INCLUDED_IN_PRO_PLUS']) {
    const [event] = normalize(input([{...raw,kind,chargedCents:500}]))
    assert.equal(event.funding,'included')
    assert.equal(event.nominal,decimalUnits('2.3365'))
    assert.equal(event.cash,BigInt(0))
    assert.equal(event.reason,null)
    assert.equal(event.quality,'complete')
    assert.equal(chargeUnits({provider:'cursor',...event,model:'claude-4.6-sonnet'},policy),decimalUnits('1.16825'))
    assert.equal(event.evidence.chargedCents,500)
    assert.equal(event.sourceKey,normalize(input([raw]))[0].sourceKey)
  }
})

test('zero charged cents cannot manufacture missing nominal value for legacy non-token usage', () => {
  for (const kind of ['USAGE_EVENT_KIND_INCLUDED_IN_ULTRA','USAGE_EVENT_KIND_INCLUDED_IN_PRO','USAGE_EVENT_KIND_INCLUDED_IN_PRO_PLUS','USAGE_EVENT_KIND_USAGE_BASED']) {
    const [event] = normalize(input([{...raw,kind,isTokenBasedCall:false,tokenUsage:null,chargedCents:0,usageBasedCosts:'0.00'}]))
    assert.equal(event.nominal,null)
    assert.equal(event.cash,BigInt(0))
    assert.equal(event.quality,'review')
    assert.equal(event.reason,'Missing provider monetary value; review required')
  }
})

test('precise zero nominal remains valid while unknown funding and fees remain held', () => {
  const [zero] = normalize(input([{...raw,kind:'USAGE_EVENT_KIND_INCLUDED_IN_PRO',tokenUsage:{totalCents:0}}]))
  assert.equal(zero.nominal,BigInt(0)); assert.equal(zero.quality,'complete')
  for(const kind of ['USAGE_EVENT_KIND_FREE_CREDIT','USAGE_EVENT_KIND_CUSTOM_SUBSCRIPTION','USAGE_EVENT_KIND_USER_API_KEY','USAGE_EVENT_KIND_ERRORED_NOT_CHARGED','USAGE_EVENT_KIND_ABORTED_NOT_CHARGED']){
    const [event]=normalize(input([{...raw,kind,chargedCents:0}]))
    assert.equal(event.funding,'unknown');assert.equal(event.quality,'review')
  }
  assert.equal(normalize(input([{...raw,kind:'USAGE_EVENT_KIND_INCLUDED_IN_PRO_PLUS',cursorTokenFee:1}]))[0].reason,'Nonzero Cursor fee requires reconciliation')
})

test('global charge rule zeroes both model families, halves other included usage, and keeps cash at face value', () => {
  assert.equal(CHARGE_RULE_VERSION, 'mpdee-global-client-charge-v1')
  const stale = { billable: true, includedBaseBps: 6000, markupBps: 1000, infrastructureMarkupBps: 2500 }
  const premium = 'claude-4.6-sonnet'
  const nominal = decimalUnits('10')
  const cash = decimalUnits('4')
  const included = (model: string | null, amount: bigint | null = nominal) =>
    chargeUnits({ provider: 'cursor', funding: 'included', nominal: amount, cash: BigInt(0), model }, stale)
  for (const model of ['grok', 'composer', 'cursor-grok', 'cursor-composer', 'grok-4', 'GROK-4.5', ' cursor-grok-4.6-xhigh-fast ', 'Cursor-Grok-4', 'composer-2', 'COMPOSER-1.5', 'cursor-composer-2', 'Cursor-Composer-1']) {
    assert.equal(isGrokOrComposerFamily(model), true, model)
    assert.equal(included(model), BigInt(0), model)
  }
  for (const model of [premium, 'gpt-5.4', 'grokking-4', 'supergrok-1', 'cursor-claude-4.6', 'x-cursor-grok-4', 'notgrok-1']) {
    assert.equal(isGrokOrComposerFamily(model), false, model)
    assert.equal(included(model), decimalUnits('5'), model)
  }
  for (const model of ['default', 'AUTO', 'unknown', 'unspecified']) {
    assert.equal(included(model), null, model)
    assert.equal(chargeUnits({ provider: 'cursor', funding: 'on-demand', nominal, cash, model }, stale), cash, model)
  }
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'free-credit', nominal, cash, model: premium }, stale), BigInt(0))
  assert.equal(included(null), null)
  assert.equal(included('   '), null)
  assert.equal(included(premium, null), null)
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'unknown', nominal, cash, model: premium }, stale), null)
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'free', nominal, cash, model: premium }, stale), BigInt(0))
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'included', nominal, cash: BigInt(0), model: 'grok-4' }, { ...stale, billable: false }), BigInt(0))
  for (const model of ['grok-4', 'cursor-grok-4', 'composer-2', 'cursor-composer-2', premium]) {
    assert.equal(chargeUnits({ provider: 'cursor', funding: 'on-demand', nominal, cash, model }, stale), cash, model)
    assert.equal(chargeUnits({ provider: 'cursor', funding: 'on-demand', nominal, cash: decimalUnits('-1.25'), model }, stale), decimalUnits('-1.25'), model)
  }
  assert.equal(chargeUnits({ provider: 'cursor', funding: 'on-demand', nominal, cash: null, model: premium }, stale), null)
  assert.equal(chargeUnits({ provider: 'vercel', funding: 'infrastructure', nominal: null, cash, model: null }, stale), cash)
  const [event] = normalize(input([{ ...raw, model: 'cursor-grok-4', kind: 'USAGE_EVENT_KIND_INCLUDED_IN_PRO' }]))
  assert.equal(event.model, 'cursor-grok-4')
  assert.equal(event.nominal, decimalUnits('2.3365'))
  assert.equal(event.cash, BigInt(0))
  assert.equal(chargeUnits({ provider: 'cursor', funding: event.funding, nominal: event.nominal, cash: event.cash, model: event.model }, stale), BigInt(0))
})

test('historical display discrepancies stay held without replacing precise or missing amounts', () => {
  for(const patch of [
    {chargedCents:0,tokenUsage:null,isTokenBasedCall:false,usageBasedCosts:'0.05'},
    {chargedCents:0,tokenUsage:{totalCents:68.43156},usageBasedCosts:'0.68'},
    {chargedCents:30.7417,tokenUsage:{totalCents:30.7417},usageBasedCosts:'0.00'},
    {chargedCents:80.39638,tokenUsage:{totalCents:337.54477},usageBasedCosts:'3.38'},
  ]) {
    const [event]=normalize(input([{...raw,...patch}]))
    assert.equal(event.quality,'review')
    assert.equal(event.cash,decimalUnits(patch.chargedCents,5))
    assert.equal(event.nominal,patch.tokenUsage===null?null:decimalUnits(patch.tokenUsage.totalCents,5))
  }
})
