import { DAY_MS } from './reliability.mjs';

const PAGE_SIZE = 250;
const MAX_PAGES = 20;
const MAX_EVENTS = PAGE_SIZE * MAX_PAGES;
const MAX_RANGE_DAYS = 45;

function isEmptyObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}
function timestampMs(event) {
  const value = event?.timestamp;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  const normalized = typeof value === 'string' && /^\d{13}$/.test(value) ? Number(value) : value;
  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchRange({ from, to, postJson, cookie }) {
  const events = [];
  let reported = null, exhausted = false, countConsistent = true;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await postJson({ teamId:0, startDate:String(from), endDate:String(to), page, pageSize:PAGE_SIZE }, cookie);
    if (page === 1 && isEmptyObject(response)) return { emptyResponse:true, events, quality:'partial' };
    if (!response || typeof response !== 'object' || Array.isArray(response) || !Array.isArray(response.usageEventsDisplay)) return { emptyResponse:false, events, quality:'partial' };
    const batch = response.usageEventsDisplay;
    if (response.totalUsageEventsCount !== undefined) {
      if (!Number.isSafeInteger(response.totalUsageEventsCount) || response.totalUsageEventsCount < 0) countConsistent = false;
      else if (reported !== null && reported !== response.totalUsageEventsCount) countConsistent = false;
      else reported = response.totalUsageEventsCount;
    }
    events.push(...batch);
    if (events.length > MAX_EVENTS) countConsistent = false;
    if (batch.length < PAGE_SIZE) { exhausted = true; break; }
  }
  const quality = exhausted && countConsistent && reported === events.length ? 'complete' : 'partial';
  return { emptyResponse:false, events, quality };
}

export async function fetchCompleteWindow({ from, to, now = Date.now(), postJson, cookie }) {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to <= from || typeof postJson !== 'function') throw new Error('Cursor usage window is invalid.');
  const target = await fetchRange({ from, to, postJson, cookie });
  if (!target.emptyResponse) return { events:target.events, quality:target.quality };

  const widerTo = Math.max(to, now);
  const widerFrom = Math.max(from - DAY_MS, widerTo - MAX_RANGE_DAYS * DAY_MS);
  if (widerFrom > from || widerTo < to || widerTo - widerFrom > MAX_RANGE_DAYS * DAY_MS) throw new Error('Cursor returned an empty response and a safe enclosing verification window is unavailable.');
  const wider = await fetchRange({ from:widerFrom, to:widerTo, postJson, cookie });
  if (wider.emptyResponse) throw new Error('Cursor returned an empty response for both target and enclosing verification windows.');
  const filtered = [];
  for (const event of wider.events) {
    const timestamp = timestampMs(event);
    if (timestamp === null) return { events:[], quality:'partial' };
    if (timestamp >= from && timestamp < to) filtered.push(event);
  }
  return { events:filtered, quality:wider.quality };
}
