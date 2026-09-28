#!/usr/bin/env node
/** Node 22.13+. Local Cursor auth is never written to output or uploaded. */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCursorCredentials, buildConversationProjectIndex, postJson, EVENTS_ENDPOINT } from './cursor-adapter.mjs';
import { sendUpload } from './upload.mjs';
import { sanitizeCursorEvent } from './sanitize.mjs';
import { fetchCompleteWindow } from './collection.mjs';
import { acquireProcessLock, collectThenFlush, collectionWindows, checkpointAfterBackfill, DAY_MS, flushOutbox, loadCheckpoint, parseBackfillRange, parseIngestEndpoint, saveCheckpoint, saveWindowPayload } from './reliability.mjs';

export { sanitizeCursorEvent as sanitize };

async function collect({ credentials, directory, days, backfill }) {
  const index = buildConversationProjectIndex();
  const checkpoint = loadCheckpoint(directory, credentials.providerAccountRef);
  const now = Date.now();
  const windows = collectionWindows({ checkpoint, initialDays: days, now, backfill });
  if (checkpoint === null && !backfill) {
    const firstFrom = windows[0]?.from ?? Math.floor(now / DAY_MS) * DAY_MS;
    saveCheckpoint(directory, credentials.providerAccountRef, firstFrom);
  }
  if (!windows.length) console.log('Local Cursor collection checkpoint is current.');
  for (const { from, to } of windows) {
    const fetched = await fetchCompleteWindow({ from, to, now, cookie:credentials.cookie,
      postJson: (request, cookie) => postJson(EVENTS_ENDPOINT, request, cookie) });
    const events = fetched.events;
    const quality = fetched.quality;
    const payload={version:'mpdee-costs-v1',provider:'cursor',accountRef:credentials.providerAccountRef,quality,events:events.map(e=>sanitizeCursorEvent(e,index))};
    const body=JSON.stringify(payload,null,2);
    if (Buffer.byteLength(body)>3_000_000) throw new Error('Daily payload exceeds 3 MB. Use a reviewed smaller window before importing.');
    const file = saveWindowPayload({ directory, accountRef:credentials.providerAccountRef, from, complete:quality === 'complete', body });
    console.log(`${new Date(from).toISOString()} — ${new Date(to).toISOString()}: ${events.length} events, ${quality}. Saved locally.`);
    if (quality!=='complete') throw new Error('Incomplete pagination or inconsistent count. File saved for review, checkpoint not advanced.');
    if (!backfill && to <= Math.floor(now / DAY_MS) * DAY_MS) saveCheckpoint(directory, credentials.providerAccountRef, to);
  }
  if (backfill) {
    const nextCheckpoint = checkpointAfterBackfill({ checkpoint, backfill, now });
    if (nextCheckpoint !== null && nextCheckpoint !== checkpoint) saveCheckpoint(directory, credentials.providerAccountRef, nextCheckpoint);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const valueFor = flag => { const at = args.indexOf(flag); return at < 0 ? null : args[at + 1]; };
  const daysValue = valueFor('--days');
  const days = daysValue === null ? 2 : Number(daysValue);
  if (!Number.isInteger(days) || days < 1 || days > 45) throw new Error('Use --days between 1 and 45');
  const flushOnly = args.includes('--flush');
  const upload = args.includes('--upload') || flushOnly;
  const fromText = valueFor('--from'), toText = valueFor('--to');
  if ((fromText === null) !== (toText === null)) throw new Error('Provide both --from and --to for a reviewed backfill.');
  if (flushOnly && fromText !== null) throw new Error('Use --from/--to with collection, then use --flush to send the saved files.');
  const backfill = fromText === null ? null : parseBackfillRange(fromText, toText);
  let endpoint, token;
  if (upload) {
    endpoint = parseIngestEndpoint(process.env.COSTS_INGEST_URL);
    token = process.env.COSTS_INGEST_TOKEN;
    if (!token || token.length < 32) throw new Error('Set a dedicated COSTS_INGEST_TOKEN (32+ characters).');
  }
  const directory = path.join(process.env.LOCALAPPDATA || path.join(homedir(),'.local','share'),'mpdee-accounts','costs-outbox');
  mkdirSync(directory,{recursive:true,mode:0o700});
  const releaseLock = acquireProcessLock(directory);
  try {
    const outcome = await collectThenFlush({
      collect: flushOnly ? null : async () => {
        const credentials = readCursorCredentials();
        if (!credentials) throw new Error('Sign in to Cursor on this computer first.');
        await collect({ credentials, directory, days, backfill });
      },
      flush: upload ? async () => flushOutbox({ directory, endpoint, token, send: (url, ingestToken, body) => sendUpload(url, ingestToken, body, process.env.COSTS_VERCEL_BYPASS_TOKEN) }) : null,
    });
    const { collectionError, flushError, flushResult } = outcome;
    if (flushResult) console.log(`Outbox flush: ${flushResult.uploaded} uploaded, ${flushResult.skipped} skipped, ${flushResult.failed} failed.`);
    if (flushError) throw new Error('Outbox flush could not complete; local files were retained for retry.');
    if (collectionError) throw new Error(`Collection did not complete: ${collectionError.message}`);
    if (flushResult?.failed) throw new Error(`${flushResult.failed} outbox file(s) remain for retry.`);
  } finally { releaseLock(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error=>{console.error(`costs: ${error?.message || 'operation failed'}`);process.exitCode=1;});
}
