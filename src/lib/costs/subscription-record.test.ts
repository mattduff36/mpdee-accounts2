import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSubscriptionRecord, saveSubscriptionRecord, SubscriptionConflict } from './subscription-record'
const fixture={version:'mpdee-subscription-v1',provider:'openai',accountRef:'chatgpt-primary',invoiceNumber:'CABACD82-0038',product:'ChatGPT Pro 100',currency:'USD',netMinor:10000,taxMinor:2000,grossMinor:12000,invoiceDate:'2026-10-28',paymentDate:'2026-10-30',periodStart:'2026-10-28',periodEnd:'2026-11-28',paymentStatus:'paid',allocationStatus:'unallocated',gbpEstimatePence:8956,fxRate:'0.7463290368779091',fxDate:'2026-10-30',fxSource:'https://www.ecb.europa.eu/stats/exchange/eurofxref/shared/pdf/2026/10/20261030.pdf',evidence:{method:'signed_in_invoice_review',reference:'CABACD82-0038'}}
test('confirmed charge and reference estimate stay separate',()=>{
 const {record}=normalizeSubscriptionRecord(fixture)
 assert.equal(record.grossMinor,12000);assert.equal(record.gbpEstimatePence,8956);assert.equal(record.allocationStatus,'unallocated')
})
test('replay is idempotent and conflicting invoice cannot overwrite',async()=>{
 let row:{id:string;checksum:string}|null=null;let writes=0
 const store={find:async()=>row,create:async(v:{checksum:string})=>{writes++;return row={id:'one',checksum:v.checksum}}}
 assert.equal((await saveSubscriptionRecord(fixture,store)).status,'added')
 assert.equal((await saveSubscriptionRecord(fixture,store)).status,'duplicate')
 await assert.rejects(saveSubscriptionRecord({...fixture,product:'Different plan'},store),SubscriptionConflict)
 assert.equal(writes,1)
})
test('reject inconsistent money, invalid dates, future FX and guessed allocations',()=>{
 for(const change of [{taxMinor:1},{gbpEstimatePence:12000},{periodEnd:'2026-02-30'},{fxDate:'2026-10-31'},{allocationStatus:'allocated'},{projectId:'guessed'}])assert.throws(()=>normalizeSubscriptionRecord({...fixture,...change}))
})
test('stable checksum ignores incoming property order; unsafe source URLs rejected',()=>{
 assert.equal(normalizeSubscriptionRecord(fixture).checksum,normalizeSubscriptionRecord(Object.fromEntries(Object.entries(fixture).reverse())).checksum)
 assert.throws(()=>normalizeSubscriptionRecord({...fixture,fxSource:'https://example.com/?secret=abc'}))
})
