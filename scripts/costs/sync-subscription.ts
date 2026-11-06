import fs from 'node:fs'
import path from 'node:path'
import { normalizeSubscriptionRecord } from '../../src/lib/costs/subscription-record'

async function main() {
  const [file,...args]=process.argv.slice(2)
  if(!file)throw new Error('Provide a subscription record JSON file; use --send to upload.')
  if(fs.statSync(file).size>16384)throw new Error('Record too large')
  const {record,checksum}=normalizeSubscriptionRecord(JSON.parse(fs.readFileSync(file,'utf8')))
  const directory=path.join(path.dirname(path.resolve(file)),'subscription-outbox')
  fs.mkdirSync(directory,{recursive:true})
  const pending=path.join(directory,`${checksum}.json`)
  fs.writeFileSync(pending,JSON.stringify(record,null,2),{flag:'w'})
  if(!args.includes('--send')){console.log('Validated and queued; no upload attempted.');return}
  const url=new URL(process.env.COSTS_SUBSCRIPTION_ENDPOINT||'')
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port||url.pathname!=='/api/costs/subscriptions')throw new Error('Use the exact HTTPS subscription endpoint without credentials or query parameters.')
  const token=process.env.COSTS_INGEST_TOKEN
  if(!token||token.length<32)throw new Error('Accounts ingest credential is missing.')
  const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(record)})
  if(!response.ok)throw new Error(`Sync returned HTTP ${response.status}; queued evidence retained.`)
  const ack=await response.json()
  if(ack.version!=='mpdee-subscription-ack-v1'||!['added','duplicate'].includes(ack.status)||ack.checksum!==checksum||typeof ack.id!=='string')throw new Error('Invalid acknowledgement; queued evidence retained.')
  fs.writeFileSync(path.join(directory,`${checksum}.ack.json`),JSON.stringify({...ack,receivedAt:new Date().toISOString()},null,2))
  // Keep original evidence for replay/audit. An acknowledgement is not an expense.
  console.log(`Subscription ${ack.status}; acknowledgement saved.`)
}
main().catch(error=>{console.error(error instanceof Error && !/https?:|postgres:|Bearer/i.test(error.message)?error.message:'Subscription sync failed; queued evidence retained.');process.exitCode=1})
