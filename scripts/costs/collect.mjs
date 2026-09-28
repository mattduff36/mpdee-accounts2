#!/usr/bin/env node
/** Node 22.13+. Local Cursor auth is never written to output or uploaded. */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCursorCredentials, verifyCursorIdentity, buildConversationProjectIndex, postJson, EVENTS_ENDPOINT } from './cursor-adapter.mjs';
import { registerCurrentAccount, collectAllAccounts, loadAccountCredential, saveAccountCredential, saveAccountStatus, EXPECTED_ACCOUNTS, normalizeEmail } from './accounts.mjs';
import { loadDesktopProfiles, saveDesktopProfile, readDesktopCredentialsForAccount, validateDesktopProfileBinding } from './desktop-profiles.mjs';
import { sendUpload } from './upload.mjs';
import { sanitizeCursorEvent } from './sanitize.mjs';
import { fetchCompleteWindow } from './collection.mjs';
import { acquireProcessLock, collectThenFlush, collectionWindows, advanceContiguousCheckpoint, DAY_MS, flushOutbox, loadCheckpoint, parseBackfillRange, parseIngestEndpoint, saveCheckpoint, saveWindowPayload } from './reliability.mjs';

export { sanitizeCursorEvent as sanitize };

export async function collect({ credentials, directory, days, backfill, now = Date.now(), index = buildConversationProjectIndex(), fetchWindow = fetchCompleteWindow }) {
  let checkpoint = loadCheckpoint(directory, credentials.providerAccountRef);
  const windows = collectionWindows({ checkpoint, initialDays: days, now, backfill });
  if (checkpoint === null) {
    const firstFrom = windows[0]?.from ?? Math.floor(now / DAY_MS) * DAY_MS;
    saveCheckpoint(directory, credentials.providerAccountRef, firstFrom);
    checkpoint = firstFrom;
  }
  if (!windows.length) console.log('Local Cursor collection checkpoint is current.');
  let failedWindows = 0;
  for (const { from, to } of windows) {
    try {
    const fetched = await fetchWindow({ from, to, now, cookie:credentials.cookie,
      postJson: (request, cookie) => postJson(EVENTS_ENDPOINT, request, cookie) });
    const events = fetched.events;
    const quality = fetched.quality;
    const payload={version:'mpdee-costs-v1',provider:'cursor',accountRef:credentials.providerAccountRef,quality,events:events.map(e=>sanitizeCursorEvent(e,index))};
    const body=JSON.stringify(payload,null,2);
    if (Buffer.byteLength(body)>3_000_000) throw new Error('Daily payload exceeds 3 MB. Use a reviewed smaller window before importing.');
    saveWindowPayload({ directory, accountRef:credentials.providerAccountRef, from, complete:quality === 'complete', body });
    console.log(`${new Date(from).toISOString()} — ${new Date(to).toISOString()}: ${events.length} events, ${quality}. Saved locally.`);
    if (quality!=='complete') throw new Error('Incomplete pagination or inconsistent count. File saved for review, checkpoint not advanced.');
    const nextCheckpoint = advanceContiguousCheckpoint({ checkpoint, from, to, now });
    if (nextCheckpoint !== checkpoint) {
      saveCheckpoint(directory, credentials.providerAccountRef, nextCheckpoint);
      checkpoint = nextCheckpoint;
    }
    } catch {
      failedWindows++;
      console.log(`${new Date(from).toISOString()}: usage window remains unresolved; retained for retry.`);
    }
  }
  const coverage = { coveredThrough:new Date(checkpoint).toISOString(), catchingUp:checkpoint < Math.floor(now / DAY_MS) * DAY_MS };
  if (failedWindows) {
    const error = new Error(`${failedWindows} Cursor usage window(s) remain unresolved; other available windows were saved.`);
    error.coverage = coverage;
    throw error;
  }
  return coverage;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--register-desktop')) {
    const at = args.indexOf('--register-desktop');
    const expectedEmail = normalizeEmail(args[at + 1]);
    const userDataDir = args[at + 2];
    if (!EXPECTED_ACCOUNTS.includes(expectedEmail)) throw new Error('Choose one of the four expected Cursor account emails.');
    if (typeof userDataDir !== 'string' || !path.isAbsolute(userDataDir) || userDataDir.includes('\0')) throw new Error('Provide the absolute Cursor desktop profile directory.');
    validateDesktopProfileBinding(expectedEmail, userDataDir);
    let credentials;
    try { credentials = readCursorCredentials(userDataDir); } catch { throw new Error('Sign in to the requested account in that Cursor desktop profile first.'); }
    if (normalizeEmail(credentials?.email) !== expectedEmail) throw new Error('Cursor desktop profile is not signed into the requested account.');
    await registerCurrentAccount({current:credentials, load:loadAccountCredential, verify:verifyCursorIdentity, persist:saveAccountCredential});
    saveDesktopProfile(expectedEmail, userDataDir);
    console.log(`Registered local Cursor desktop profile for ${expectedEmail}. No usage collected.`);
    return;
  }
  if (args.includes('--register-current')) {
    let credentials;
    try { credentials = readCursorCredentials(); } catch { throw new Error('Sign in to an expected Cursor desktop account first.'); }
    const email = await registerCurrentAccount({current:credentials, load:loadAccountCredential, verify:verifyCursorIdentity, persist:saveAccountCredential});
    console.log(`Registered protected local Cursor session for ${email}. No usage collected.`);
    return;
  }
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
    let accountStatus = null;
    const outcome = await collectThenFlush({
      collect: flushOnly ? null : async () => {
        let current = null;
        try { current = readCursorCredentials(); } catch { /* Retained sessions can still collect if desktop is unavailable. */ }
        const profiles = loadDesktopProfiles();
        const status = await collectAllAccounts({ current, currentForAccount:email => readDesktopCredentialsForAccount(email, profiles) ?? (normalizeEmail(current?.email) === email ? current : null), load:loadAccountCredential, verify:verifyCursorIdentity,
          persist:saveAccountCredential, collect:credentials => collect({ credentials, directory, days, backfill }) });
        saveAccountStatus(directory, status);
        accountStatus = status;
        for (const account of status.accounts) console.log(`Cursor ${account.email}: ${account.state}.`);
        if (status.succeeded !== status.expected) throw new Error(`${status.succeeded}/${status.expected} expected Cursor accounts collected; inspect accounts-status.json locally.`);
      },
      flush: upload ? async () => flushOutbox({ directory, endpoint, token, send: (url, ingestToken, body) => sendUpload(url, ingestToken, body, process.env.COSTS_VERCEL_BYPASS_TOKEN) }) : null,
    });
    const { collectionError, flushError, flushResult } = outcome;
    if (accountStatus) {
      accountStatus.uploadState = !upload ? 'not_requested' : (flushError || flushResult?.failed ? 'failed' : 'success');
      saveAccountStatus(directory, accountStatus);
    }
    if (accountStatus && upload) {
      // Publish fixed health metadata only; keep collection results even if reporting fails.
      try {
        const statusUrl = new URL('/api/costs/collector-status', endpoint);
        const response = await fetch(statusUrl, { method:'POST', redirect:'manual', signal:AbortSignal.timeout(20000),
          headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:JSON.stringify(accountStatus) });
        if (!response.ok) throw new Error();
      } catch { throw new Error('Collection status could not be published; local usage and status were retained.'); }
    }
    if (flushResult) console.log(`Outbox flush: ${flushResult.uploaded} uploaded, ${flushResult.skipped} skipped, ${flushResult.failed} failed.`);
    if (flushError) throw new Error('Outbox flush could not complete; local files were retained for retry.');
    if (collectionError) throw new Error(`Collection did not complete: ${collectionError.message}`);
    if (flushResult?.failed) throw new Error(`${flushResult.failed} outbox file(s) remain for retry.`);
  } finally { releaseLock(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error=>{console.error(`costs: ${error?.message || 'operation failed'}`);process.exitCode=1;});
}
