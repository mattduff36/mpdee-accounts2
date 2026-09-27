#!/usr/bin/env node
/** Node 22.13+. Local Cursor auth is never written to output or uploaded. */
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCursorCredentials, buildConversationProjectIndex, postJson, EVENTS_ENDPOINT } from './cursor-adapter.mjs';

const fields = ['timestamp','model','conversationId','kind','isTokenBasedCall','chargedCents','usageBasedCosts','cursorTokenFee'];
export function sanitize(event, index) {
  const result = Object.fromEntries(fields.filter(k => event[k] !== undefined).map(k => [k,event[k]]));
  if (event.tokenUsage) result.tokenUsage = Object.fromEntries(['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','totalCents'].filter(k => event.tokenUsage[k] !== undefined).map(k => [k,event.tokenUsage[k]]));
  const workspace = index.get(event.conversationId);
  if (workspace) result.workspaceRef = workspace;
  return result;
}
async function main() {
  const args = process.argv.slice(2);
  const daysAt = args.indexOf('--days');
  const days = daysAt < 0 ? 2 : Number(args[daysAt+1]);
  if (!Number.isInteger(days) || days < 1 || days > 45) throw new Error('Use --days between 1 and 45');
  const upload = args.includes('--upload');
  let endpoint;
  if (upload) {
    endpoint = new URL(process.env.COSTS_INGEST_URL ?? '');
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.pathname !== '/api/costs/ingest' || endpoint.search || endpoint.hash) throw new Error('Set COSTS_INGEST_URL to the HTTPS Accounts /api/costs/ingest endpoint');
    if (!process.env.COSTS_INGEST_TOKEN || process.env.COSTS_INGEST_TOKEN.length < 32) throw new Error('Set a dedicated COSTS_INGEST_TOKEN (32+ characters)');
  }
  const credentials = readCursorCredentials();
  if (!credentials) throw new Error('Sign in to Cursor on this computer first');
  const index = buildConversationProjectIndex();
  const directory = path.join(process.env.LOCALAPPDATA || path.join(homedir(),'.local','share'),'mpdee-accounts','costs-outbox');
  mkdirSync(directory,{recursive:true,mode:0o700});
  const now = Date.now();
  for (let d=days; d>0; d--) {
    const from = now-d*86400000, to=now-(d-1)*86400000;
    const events=[];
    let reported=null, exhausted=false;
    for (let page=1;page<=20;page++) {
      const response=await postJson(EVENTS_ENDPOINT,{teamId:0,startDate:String(from),endDate:String(to),page,pageSize:250},credentials.cookie);
      if (!Array.isArray(response.usageEventsDisplay)) throw new Error('Cursor response format changed. No data sent.');
      const batch=response.usageEventsDisplay;
      if (typeof response.totalUsageEventsCount==='number') reported=response.totalUsageEventsCount;
      events.push(...batch);
      if (batch.length<250) {exhausted=true;break;}
    }
    const quality=exhausted && reported===events.length ? 'complete' : 'partial';
    const payload={version:'mpdee-costs-v1',provider:'cursor',accountRef:credentials.providerAccountRef,quality,events:events.map(e=>sanitize(e,index))};
    const body=JSON.stringify(payload,null,2);
    if (Buffer.byteLength(body)>3_000_000) throw new Error('Daily payload exceeds 3 MB. Use narrower windows before importing.');
    const file=path.join(directory,`${credentials.providerAccountRef}-${from}-${to}.json`);
    writeFileSync(`${file}.tmp`,body,{mode:0o600});renameSync(`${file}.tmp`,file);
    console.log(`${new Date(from).toISOString()} — ${new Date(to).toISOString()}: ${events.length} events, ${quality}. Saved ${file}`);
    if (quality!=='complete') throw new Error('Incomplete pagination or inconsistent count. File saved for review, not uploaded.');
    if (upload) {
      const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(65000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.COSTS_INGEST_TOKEN}`},body});
      if (!response.ok) throw new Error(`Accounts import returned HTTP ${response.status}. File retained locally for retry.`);
      const result=await response.json();
      console.log(`Imported ${result.added} new, ${result.revised} revised, ${result.duplicate} unchanged; ${result.unassigned} unassigned.`);
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error=>{console.error(`costs: ${error.message}`);process.exitCode=1;});
}
