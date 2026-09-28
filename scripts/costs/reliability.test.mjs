import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sendUpload } from './upload.mjs';
import { sanitizeCursorEvent, isSanitizedCursorEvent } from './sanitize.mjs';
import { postJson, EVENTS_ENDPOINT } from './cursor-adapter.mjs';
import { fetchCompleteWindow } from './collection.mjs';
import { collectionWindows, DAY_MS, flushOutbox, retryTransient, acquireProcessLock, loadCheckpoint, saveCheckpoint, parseBackfillRange, parseIngestEndpoint, collectThenFlush, checkpointAfterBackfill, advanceContiguousCheckpoint, saveWindowPayload, isSanitizedCursorPayload } from './reliability.mjs';

function fixtureDir() { return mkdtempSync(path.join(os.tmpdir(), 'costs-recovery-')); }
const ack = (received, { added = received, revised = 0, duplicate = 0, unassigned = 0 } = {}) => ({ ok: true, acknowledgement: { received, added, revised, duplicate, unassigned, quality: 'complete' } });

test('collection re-fetches two closed days and includes the current partial UTC day', () => {
  const now = 100 * DAY_MS + 123;
  const windows = collectionWindows({ now, checkpoint: 98 * DAY_MS });
  assert.deepEqual(windows, [
    { from: 96 * DAY_MS, to: 97 * DAY_MS },
    { from: 97 * DAY_MS, to: 98 * DAY_MS },
    { from: 98 * DAY_MS, to: 99 * DAY_MS },
    { from: 99 * DAY_MS, to: 100 * DAY_MS },
    { from: 100 * DAY_MS, to: 100 * DAY_MS + 123 },
  ]);
  assert.equal(collectionWindows({ now, initialDays: 2 })[0].from, 98 * DAY_MS);
});

test('a hundred-day gap recovers a bounded oldest batch and refreshes recent usage separately', () => {
  const now = 200 * DAY_MS + 123;
  let checkpoint = 100 * DAY_MS;
  const windows = collectionWindows({ now, checkpoint });
  assert.equal(windows.length, 10);
  assert.deepEqual(windows.slice(0, 7).map(w => w.from / DAY_MS), [98, 99, 100, 101, 102, 103, 104]);
  assert.deepEqual(windows.slice(7).map(w => w.from / DAY_MS), [198, 199, 200]);
  assert.equal(windows.at(-1).to, now);
  for (const window of windows) checkpoint = advanceContiguousCheckpoint({ checkpoint, ...window, now });
  assert.equal(checkpoint, 105 * DAY_MS, 'recent windows cannot jump the unresolved gap');
  assert.equal(new Set(windows.map(w => w.from)).size, windows.length);
});

test('a missing day prevents cursor advancement and current-day collection stays separate', () => {
  const now = 105 * DAY_MS + 123;
  let checkpoint = 100 * DAY_MS;
  checkpoint = advanceContiguousCheckpoint({ checkpoint, from: 102 * DAY_MS, to: 103 * DAY_MS, now });
  assert.equal(checkpoint, 100 * DAY_MS);
  checkpoint = advanceContiguousCheckpoint({ checkpoint, from: 99 * DAY_MS, to: 100 * DAY_MS, now });
  assert.equal(checkpoint, 100 * DAY_MS, 'overlap cannot regress the cursor');
  checkpoint = advanceContiguousCheckpoint({ checkpoint, from: 100 * DAY_MS, to: 101 * DAY_MS, now });
  assert.equal(checkpoint, 101 * DAY_MS);
  assert.equal(advanceContiguousCheckpoint({ checkpoint:105 * DAY_MS, from:105 * DAY_MS, to:now, now }), 105 * DAY_MS);
  assert.throws(() => advanceContiguousCheckpoint({ checkpoint, from:102 * DAY_MS, to:now + 1, now }), /Invalid/);
});

test('explicit backfills are valid UTC date ranges bounded to 45 days', () => {
  const now = 100 * DAY_MS + 123;
  assert.deepEqual(parseBackfillRange('1970-04-06', '1970-04-10', now), { from: 95 * DAY_MS, to: 100 * DAY_MS });
  assert.throws(() => parseBackfillRange('1970-04-11', '1970-04-10', now), /ordered/);
  assert.throws(() => parseBackfillRange('1970-01-01', '1970-02-20', now), /cannot exceed 45 days/);
  assert.throws(() => parseBackfillRange('1970-04-06', '1970-04-12', now), /cannot be in the future/);
});

test('empty target response is verified using a complete enclosing window', async () => {
  const from = 100 * DAY_MS, to = 101 * DAY_MS, now = 102 * DAY_MS + 123;
  const calls = [];
  const result = await fetchCompleteWindow({ from, to, now, cookie:'test-only', postJson:async (request, cookie) => {
    calls.push({ request, cookie });
    if (calls.length === 1) return {};
    return { usageEventsDisplay:[{ timestamp:from - 1 }, { timestamp:to + 1 }], totalUsageEventsCount:2 };
  } });
  assert.equal(result.quality, 'complete');
  assert.deepEqual(result.events, []);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].request.startDate, String(from - DAY_MS));
  assert.equal(calls[1].request.endDate, String(now));
});

test('empty target and empty enclosing responses fail closed', async () => {
  let calls = 0;
  await assert.rejects(fetchCompleteWindow({ from:100*DAY_MS, to:101*DAY_MS, now:102*DAY_MS, cookie:'test-only', postJson:async () => { calls++; return {}; } }), /both target and enclosing/);
  assert.equal(calls, 2);
});

test('inconsistent target or verification counts remain incomplete', async () => {
  const target = await fetchCompleteWindow({ from:100*DAY_MS, to:101*DAY_MS, now:102*DAY_MS, cookie:'test-only', postJson:async () => ({ usageEventsDisplay:[], totalUsageEventsCount:1 }) });
  assert.equal(target.quality, 'partial');
  let calls = 0;
  const verified = await fetchCompleteWindow({ from:100*DAY_MS, to:101*DAY_MS, now:102*DAY_MS, cookie:'test-only', postJson:async () => ++calls === 1 ? {} : ({ usageEventsDisplay:[{ timestamp:100*DAY_MS+1 }], totalUsageEventsCount:2 }) });
  assert.equal(verified.quality, 'partial');
  assert.equal(verified.events.length, 1);
});
test('sanitizer accepts provider timestamp strings and bounded labels but rejects nested values', () => {
  const index = new Map();
  const valid = sanitizeCursorEvent({ timestamp: '1759012345678', model: 'model', usageBasedCosts: '-', tokenUsage: null }, index);
  assert.equal(valid.timestamp, '1759012345678');
  assert.equal(valid.usageBasedCosts, '-');
  assert.equal(valid.tokenUsage, null);
  assert.equal(isSanitizedCursorEvent({ timestamp: '1759012345678', chargedCents: { secret: 'never-copy' } }), false);
  assert.throws(() => sanitizeCursorEvent({ timestamp: '1759012345678', model: { secret: 'never-copy' } }, index), error => !error.message.includes('never-copy'));
  assert.throws(() => sanitizeCursorEvent({ timestamp: '1759012345678', tokenUsage: 'invalid' }, index), /invalid token usage/);
});

test('partial window writes preserve the complete canonical file and never flush', async () => {
  const directory = fixtureDir();
  try {
    const accountRef = 'e'.repeat(32), from = 100 * DAY_MS;
    const completeBody = JSON.stringify({ version: 'mpdee-costs-v1', provider: 'cursor', accountRef, quality: 'complete', events: [{ timestamp: '1759012345678' }] });
    const partialBody = JSON.stringify({ version: 'mpdee-costs-v1', provider: 'cursor', accountRef, quality: 'complete', events: [{ timestamp: '1759012345679' }] });
    const canonical = saveWindowPayload({ directory, accountRef, from, complete: true, body: completeBody });
    const reviewOnly = saveWindowPayload({ directory, accountRef, from, complete: false, body: partialBody });
    assert.notEqual(reviewOnly, canonical);
    assert.equal(readFileSync(canonical, 'utf8'), completeBody);
    assert.equal(readFileSync(reviewOnly, 'utf8'), partialBody);
    let calls = 0;
    const result = await flushOutbox({ directory, endpoint: new URL('https://preview.example/api/costs/ingest'), token: 'unused', send: async (_url, _token, body) => { calls++; assert.equal(body, completeBody); return ack(1); } });
    assert.deepEqual(result, { uploaded: 1, skipped: 0, failed: 0 });
    assert.equal(calls, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('malformed ingest URLs never echo embedded secrets', () => {
  const secret = 'token-that-must-not-appear';
  assert.throws(() => parseIngestEndpoint(`https://user:${secret}@example.invalid/not-ingest`), error => !error.message.includes(secret));
  assert.throws(() => parseIngestEndpoint(`https://example.invalid/api/costs/ingest?key=${secret}`), error => !error.message.includes(secret));
});

test('malformed Cursor JSON errors do not expose response content', async () => {
  const originalFetch = globalThis.fetch;
  const secretText = 'provider-response-secret';
  globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError(`unexpected token ${secretText}`); } });
  try {
    await assert.rejects(postJson(EVENTS_ENDPOINT, {}, 'test-only-session'), error => error.message === 'Cursor dashboard response was not valid JSON.' && !error.message.includes(secretText));
  } finally { globalThis.fetch = originalFetch; }
});
test('Vercel bypass header is sent only to the exact preview host and redirects are rejected', async () => {
  const originalFetch = globalThis.fetch;
  const fakeBypass = 'test-only-bypass-value';
  let captured = null, calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    captured = options;
    return { ok: true, json: async () => ({ received: 0, added: 0, revised: 0, duplicate: 0, unassigned: 0, quality: 'complete' }) };
  };
  try {
    const allowed = new URL('https://mpdee-accounts2-git-preview-mpdees-projects.vercel.app/api/costs/ingest');
    await sendUpload(allowed, 'test-only-ingest-token', '{}', fakeBypass);
    assert.equal(captured.headers['x-vercel-protection-bypass'], fakeBypass);
    assert.equal(captured.redirect, 'error');
    await assert.rejects(sendUpload(new URL('https://accounts.example/api/costs/ingest'), 'test-only-ingest-token', '{}', fakeBypass), error => !error.message.includes(fakeBypass));
    assert.equal(calls, 1);
    globalThis.fetch = async (_url, options) => { calls++; captured = options; return { ok: false, status: 302 }; };
    await assert.rejects(sendUpload(allowed, 'test-only-ingest-token', '{}', fakeBypass), /HTTP 302/);
    assert.equal(captured.redirect, 'error');
    assert.equal(calls, 2);
    globalThis.fetch = async () => ({ ok: true, json: async () => { throw new Error('malformed'); } });
    await assert.rejects(sendUpload(allowed, 'test-only-ingest-token', '{}'), /invalid acknowledgement/);
  } finally { globalThis.fetch = originalFetch; }
});
test('retryTransient retries only explicitly transient failures with bounded backoff', async () => {
  let calls = 0;
  const delays = [];
  const result = await retryTransient(async () => {
    calls++;
    if (calls < 3) { const error = new Error('temporary'); error.transient = true; throw error; }
    return 'ok';
  }, { attempts: 3, baseDelayMs: 10, sleepFn: async ms => delays.push(ms) });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
  calls = 0;
  await assert.rejects(retryTransient(async () => { calls++; throw new Error('permanent'); }, { sleepFn: async () => assert.fail('must not wait') }), /permanent/);
  assert.equal(calls, 1);
});

test('flush accepts null tokenUsage, rejects secret-bearing fields, and receipts are destination/content specific', async () => {
  const directory = fixtureDir();
  try {
    const accountRef = 'a'.repeat(32);
    const payload = { version: 'mpdee-costs-v1', provider: 'cursor', accountRef, quality: 'complete', events: [{ timestamp: '2026-09-28T00:00:00Z', chargedCents: 4, tokenUsage: null }] };
    const completePath = path.join(directory, `${accountRef}-1-2.json`);
    writeFileSync(completePath, JSON.stringify(payload));
    assert.equal(isSanitizedCursorPayload(payload, path.basename(completePath), accountRef), true);
    assert.equal(isSanitizedCursorPayload({ ...payload, extraSecret: 'never-upload' }, path.basename(completePath), accountRef), false);
    writeFileSync(path.join(directory, `${accountRef}-3-4.json`), JSON.stringify({ ...payload, quality: 'partial' }));
    writeFileSync(path.join(directory, `${accountRef}-5-6.json`), JSON.stringify({ ...payload, events: [{ cookie: 'should-not-upload' }] }));
    writeFileSync(path.join(directory, `${accountRef}-7-8.json`), JSON.stringify({ ...payload, accessToken: 'should-not-upload' }));
    writeFileSync(path.join(directory, 'broken.json'), '{');
    const firstEndpoint = new URL('https://preview-one.example/api/costs/ingest');
    let calls = 0;
    const first = await flushOutbox({ directory, endpoint: firstEndpoint, token: 'unused', send: async (_url, _token, body) => { calls++; assert.equal(body, JSON.stringify(payload)); return ack(1, { added: 1, unassigned: 1 }); } });
    assert.deepEqual(first, { uploaded: 1, skipped: 0, failed: 3 });
    assert.equal(calls, 1);
    const second = await flushOutbox({ directory, endpoint: firstEndpoint, token: 'unused', send: async () => { calls++; return ack(1); } });
    assert.deepEqual(second, { uploaded: 0, skipped: 1, failed: 3 });
    assert.equal(calls, 1);
    const otherDestination = await flushOutbox({ directory, endpoint: new URL('https://preview-two.example/api/costs/ingest'), token: 'unused', send: async () => { calls++; return ack(1); } });
    assert.deepEqual(otherDestination, { uploaded: 1, skipped: 0, failed: 3 });
    assert.equal(calls, 2);
    const changed = JSON.stringify({ ...payload, events: [{ timestamp: '2026-09-28T00:00:00Z', chargedCents: 5, tokenUsage: null }] });
    writeFileSync(completePath, changed);
    const revised = await flushOutbox({ directory, endpoint: firstEndpoint, token: 'unused', send: async () => { calls++; return ack(1); } });
    assert.deepEqual(revised, { uploaded: 1, skipped: 0, failed: 3 });
    assert.equal(calls, 3);
    assert.ok(readdirSync(directory).some(name => name.includes('.receipt.json')));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('bad acknowledgement is retained without blocking later eligible files', async () => {
  const directory = fixtureDir();
  try {
    const accountRef = 'd'.repeat(32);
    for (const n of [1, 2]) writeFileSync(path.join(directory, `${accountRef}-${n}-${n + 1}.json`), JSON.stringify({ version: 'mpdee-costs-v1', provider: 'cursor', accountRef, quality: 'complete', events: [{ timestamp: '1759012345678', chargedCents: n }] }));
    let calls = 0;
    const result = await flushOutbox({ directory, endpoint: new URL('https://preview.example/api/costs/ingest'), token: 'unused', send: async () => ++calls === 1 ? ack(0) : ack(1) });
    assert.deepEqual(result, { uploaded: 1, skipped: 0, failed: 1 });
    assert.equal(calls, 2);
    assert.equal(readdirSync(directory).filter(name => name.endsWith('.receipt.json')).length, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('corrupt and oversized canonical files fail while local metadata is excluded', async () => {
  const directory = fixtureDir();
  try {
    const accountRef = 'f'.repeat(32);
    const corrupt = path.join(directory, `${accountRef}-1-2.json`);
    writeFileSync(corrupt, '{');
    writeFileSync(path.join(directory, `${accountRef}-3-4.json`), JSON.stringify({ padding:'x'.repeat(3_000_001) }));
    for (const name of ['accounts-status.json', `${accountRef}.checkpoint.json`, `${accountRef}-5-6.partial.json`, `${accountRef}-1-2.json.dest.receipt.json`, 'unrelated.json']) writeFileSync(path.join(directory, name), '{');
    const result = await flushOutbox({ directory, endpoint:new URL('https://preview.example/api/costs/ingest'), token:'unused', send:async()=>assert.fail('invalid files must not upload') });
    assert.deepEqual(result, { uploaded:0, skipped:0, failed:2 });
    assert.equal(readFileSync(corrupt, 'utf8'), '{');
    assert.equal(readdirSync(directory).length, 7);
  } finally { rmSync(directory, { recursive:true, force:true }); }
});

test('flush retains payload and records failure without a receipt after transport errors', async () => {
  const directory = fixtureDir();
  try {
    const accountRef = 'b'.repeat(32);
    const file = path.join(directory, `${accountRef}-1-2.json`);
    writeFileSync(file, JSON.stringify({ version: 'mpdee-costs-v1', provider: 'cursor', accountRef, quality: 'complete', events: [] }));
    const result = await flushOutbox({ directory, endpoint: new URL('https://preview.example/api/costs/ingest'), token: 'unused', send: async () => { throw new Error('network'); } });
    assert.deepEqual(result, { uploaded: 0, skipped: 0, failed: 1 });
    assert.ok(readFileSync(file, 'utf8').includes('complete'));
    assert.equal(readdirSync(directory).filter(name => name.endsWith('.receipt.json')).length, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('contiguous bounded backfill chunks recover a stale checkpoint without jumping a gap', () => {
  const now = 100 * DAY_MS + 123;
  let checkpoint = 54 * DAY_MS;
  assert.equal(collectionWindows({ now, checkpoint }).length, 10);
  const first = { from: checkpoint, to: 99 * DAY_MS };
  checkpoint = checkpointAfterBackfill({ checkpoint, backfill: first, now });
  assert.equal(checkpoint, 99 * DAY_MS);
  assert.doesNotThrow(() => collectionWindows({ now, checkpoint }));
  const gap = checkpointAfterBackfill({ checkpoint, backfill: { from: 100 * DAY_MS, to: now }, now });
  assert.equal(gap, checkpoint);
  const older = checkpointAfterBackfill({ checkpoint, backfill: { from: 40 * DAY_MS, to: 50 * DAY_MS }, now });
  assert.equal(older, checkpoint);
});
test('checkpoint persists each account cursor locally', () => {
  const directory = fixtureDir();
  try {
    const accountRef = 'c'.repeat(32);
    saveCheckpoint(directory, accountRef, 123 * DAY_MS);
    assert.equal(loadCheckpoint(directory, accountRef), 123 * DAY_MS);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('flush is attempted even when collection fails', async () => {
  let flushed = false;
  const result = await collectThenFlush({ collect: async () => { throw new Error('offline'); }, flush: async () => { flushed = true; return { uploaded: 1 }; } });
  assert.equal(flushed, true);
  assert.equal(result.collectionError.message, 'offline');
  assert.deepEqual(result.flushResult, { uploaded: 1 });
});

test('process lock prevents overlapping runs and releases cleanly', () => {
  const directory = fixtureDir();
  try {
    const release = acquireProcessLock(directory);
    assert.throws(() => acquireProcessLock(directory), /already running/);
    release();
    const releaseAgain = acquireProcessLock(directory);
    releaseAgain();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
