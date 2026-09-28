import { createHash } from 'node:crypto';
import { openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { isSanitizedCursorEvent } from './sanitize.mjs';

export const DAY_MS = 86_400_000;
const MAX_CATCHUP_DAYS = 45;
const OVERLAP_DAYS = 2;
const AUTOMATIC_BATCH_DAYS = 7;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function retryTransient(operation, { attempts = 3, baseDelayMs = 250, sleepFn = sleep } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await operation(attempt); }
    catch (error) {
      if (!error?.transient || attempt >= attempts) throw error;
      await sleepFn(baseDelayMs * (2 ** (attempt - 1)));
    }
  }
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

export function acquireProcessLock(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, '.collector.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      return () => { try { closeSync(fd); } catch {} try { unlinkSync(lockPath); } catch {} };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw new Error('Could not acquire local costs collector lock.');
      let owner;
      try { owner = JSON.parse(readFileSync(lockPath, 'utf8')); } catch {}
      if (attempt === 0 && owner && !processExists(owner.pid)) {
        try { unlinkSync(lockPath); continue; } catch {}
      }
      throw new Error('Another costs collection or upload is already running.');
    }
  }
  throw new Error('Could not acquire local costs collector lock.');
}

export function checkpointPath(directory, accountRef) {
  return path.join(directory, `${accountRef}.checkpoint.json`);
}

export function loadCheckpoint(directory, accountRef) {
  try {
    const value = JSON.parse(readFileSync(checkpointPath(directory, accountRef), 'utf8'));
    if (value.version !== 1 || value.accountRef !== accountRef || !Number.isSafeInteger(value.through) || value.through % DAY_MS !== 0) throw new Error();
    return value.through;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error('Local costs checkpoint is invalid; preserve it and inspect before continuing.');
  }
}

export function saveCheckpoint(directory, accountRef, through) {
  const file = checkpointPath(directory, accountRef);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ version: 1, accountRef, through }), { mode: 0o600 });
  renameSync(temp, file);
}

function splitWindows(start, end) {
  const windows = [];
  for (let from = start; from < end;) {
    const nextMidnight = Math.floor(from / DAY_MS) * DAY_MS + DAY_MS;
    const to = Math.min(nextMidnight, end);
    windows.push({ from, to });
    from = to;
  }
  return windows;
}

export function parseBackfillRange(fromText, toText, now = Date.now()) {
  const parseDate = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Use --from and --to as UTC dates in YYYY-MM-DD format.');
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isSafeInteger(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new Error('Use valid UTC dates with --from and --to.');
    return parsed;
  };
  const from = parseDate(fromText);
  const toDate = parseDate(toText);
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
  if (toDate > todayStart) throw new Error('Backfill end date cannot be in the future.');
  const to = Math.min(toDate + DAY_MS, now);
  if (toDate < from || from >= now || to <= from) throw new Error('Backfill date range must be ordered and cannot start in the future.');
  if (to - from > MAX_CATCHUP_DAYS * DAY_MS) throw new Error('Explicit backfill range cannot exceed 45 days.');
  return { from, to };
}

export function checkpointAfterBackfill({ checkpoint, backfill, now = Date.now() }) {
  const completedThrough = Math.min(backfill.to, Math.floor(now / DAY_MS) * DAY_MS);
  if (completedThrough <= backfill.from) return checkpoint ?? null;
  if (checkpoint === null || checkpoint === undefined) return completedThrough;
  if (backfill.from <= checkpoint && completedThrough > checkpoint) return completedThrough;
  return checkpoint;
}
// Only completed windows contiguous with the durable cursor can advance it.
// Recent refreshes after an unresolved historical gap must never conceal that gap.
export function advanceContiguousCheckpoint({ checkpoint, from, to, now = Date.now() }) {
  if (!Number.isSafeInteger(checkpoint) || checkpoint < 0 || checkpoint % DAY_MS !== 0 ||
      !Number.isSafeInteger(from) || from < 0 || from % DAY_MS !== 0 ||
      !Number.isSafeInteger(to) || to <= from || to > now || checkpoint > Math.floor(now / DAY_MS) * DAY_MS) {
    throw new Error('Invalid contiguous collection checkpoint window.');
  }
  const completedThrough = Math.floor(to / DAY_MS) * DAY_MS;
  return from <= checkpoint && completedThrough > checkpoint ? completedThrough : checkpoint;
}
export function collectionWindows({ now = Date.now(), checkpoint, initialDays = 2, backfill = null }) {
  if (!Number.isInteger(initialDays) || initialDays < 1 || initialDays > MAX_CATCHUP_DAYS) throw new Error('Use --days between 1 and 45');
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
  if (backfill) {
    if (!Number.isSafeInteger(backfill.from) || !Number.isSafeInteger(backfill.to) || backfill.from % DAY_MS !== 0 || backfill.to > now || backfill.to <= backfill.from || backfill.to - backfill.from > MAX_CATCHUP_DAYS * DAY_MS) throw new Error('Explicit backfill range must be valid and no longer than 45 days.');
    return splitWindows(backfill.from, backfill.to);
  }
  if (checkpoint !== null && checkpoint !== undefined && (!Number.isSafeInteger(checkpoint) || checkpoint % DAY_MS !== 0 || checkpoint > todayStart)) throw new Error('Local costs checkpoint is invalid for the current date.');
  const start = checkpoint === null || checkpoint === undefined
    ? todayStart - initialDays * DAY_MS
    : Math.max(0, checkpoint - OVERLAP_DAYS * DAY_MS);
  // Bound automatic recovery even after a long offline period, while still
  // refreshing recent usage. The caller retains the contiguous checkpoint.
  const oldest = splitWindows(start, Math.min(now, start + AUTOMATIC_BATCH_DAYS * DAY_MS));
  const recent = splitWindows(Math.max(start, todayStart - OVERLAP_DAYS * DAY_MS), now);
  return [...new Map([...oldest, ...recent].map(window => [window.from, window])).values()]
    .sort((a, b) => a.from - b.from);
}

export function outboxWindowPath(directory, accountRef, from, complete) {
  const to = Math.floor(from / DAY_MS) * DAY_MS + DAY_MS;
  const canonical = path.join(directory, `${accountRef}-${from}-${to}.json`);
  return complete ? canonical : canonical.replace(/\.json$/, '.partial.json');
}

export function saveWindowPayload({ directory, accountRef, from, complete, body }) {
  const file = outboxWindowPath(directory, accountRef, from, complete);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, body, { mode: 0o600 });
  renameSync(temp, file);
  return file;
}
export function destinationId(endpoint) {
  return createHash('sha256').update(`${endpoint.origin}${endpoint.pathname}`).digest('hex').slice(0, 16);
}

const TOP_LEVEL_FIELDS = new Set(['version','provider','accountRef','quality','events']);
export function isSanitizedCursorPayload(payload, name, accountRef) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !TOP_LEVEL_FIELDS.has(key))) return false;
  if (payload.version !== 'mpdee-costs-v1' || payload.provider !== 'cursor' || payload.quality !== 'complete' || !/^[a-f0-9]{32}$/.test(payload.accountRef) || !Array.isArray(payload.events)) return false;
  if (accountRef && payload.accountRef !== accountRef) return false;
  if (!name.startsWith(`${payload.accountRef}-`) || name.endsWith('.partial.json')) return false;
  return payload.events.every(isSanitizedCursorEvent);
}

function validAcknowledgement(result, eventCount) {
  const ack = result?.acknowledgement;
  if (result?.ok !== true || !ack || ack.received !== eventCount || ack.quality !== 'complete') return false;
  const counts = ['added','revised','duplicate','unassigned'];
  if (!counts.every(key => Number.isSafeInteger(ack[key]) && ack[key] >= 0)) return false;
  return ack.added + ack.revised + ack.duplicate === eventCount && ack.unassigned <= eventCount;
}

export async function flushOutbox({ directory, endpoint, token, send, accountRef = null }) {
  const dest = destinationId(endpoint);
  const files = readdirSync(directory).filter(name => /^[a-f0-9]{32}-\d+-\d+\.json$/.test(name)).sort();
  let uploaded = 0, skipped = 0, failed = 0;
  for (const name of files) {
    const file = path.join(directory, name);
    if (accountRef && !name.startsWith(`${accountRef}-`)) { skipped++; continue; }
    let body, payload;
    try { body = readFileSync(file, 'utf8'); payload = JSON.parse(body); }
    catch { failed++; continue; }
    if (Buffer.byteLength(body) > 3_000_000 || !isSanitizedCursorPayload(payload, name, accountRef)) { failed++; continue; }
    const hash = createHash('sha256').update(body).digest('hex');
    const receiptPath = `${file}.${dest}.receipt.json`;
    try {
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
      if (receipt.version === 1 && receipt.destination === dest && receipt.sha256 === hash) { skipped++; continue; }
    } catch {}
    try {
      const response = await send(endpoint, token, body);
      if (!validAcknowledgement(response, payload.events.length)) { failed++; continue; }
      const receiptTemp = `${receiptPath}.${process.pid}.tmp`;
      writeFileSync(receiptTemp, JSON.stringify({ version: 1, destination: dest, sha256: hash, uploadedAt: Date.now() }), { mode: 0o600 });
      renameSync(receiptTemp, receiptPath);
      uploaded++;
    } catch {
      failed++;
    }
  }
  return { uploaded, skipped, failed };
}

export function parseIngestEndpoint(value) {
  let endpoint;
  try { endpoint = new URL(value ?? ''); } catch { throw new Error('Set COSTS_INGEST_URL to the HTTPS Accounts /api/costs/ingest endpoint.'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.pathname !== '/api/costs/ingest' || endpoint.search || endpoint.hash) throw new Error('Set COSTS_INGEST_URL to the HTTPS Accounts /api/costs/ingest endpoint.');
  return endpoint;
}

export async function collectThenFlush({ collect, flush }) {
  let collectionError = null, flushError = null, flushResult = null;
  if (collect) { try { await collect(); } catch (error) { collectionError = error; } }
  if (flush) { try { flushResult = await flush(); } catch (error) { flushError = error; } }
  return { collectionError, flushError, flushResult };
}
