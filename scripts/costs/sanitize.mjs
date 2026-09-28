import { CONTEXT_LABELS } from "./task-context.mjs";
const EVENT_FIELDS = new Set(['timestamp','model','conversationId','kind','isTokenBasedCall','chargedCents','usageBasedCosts','cursorTokenFee','tokenUsage','workspaceRef','taskContext']);
const TOKEN_FIELDS = new Set(['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','totalCents']);
const AMOUNT_STRING = /^-?\d+(\.\d+)?$/;
const COST_STRING = /^\$?\d+(\.\d+)?$/;

function validAmount(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 50 && AMOUNT_STRING.test(value));
}
function validToken(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}
function validTimestamp(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  if (typeof value === 'number' && !Number.isFinite(value)) return false;
  const normalized = typeof value === 'string' && /^\d{13}$/.test(value) ? Number(value) : value;
  return Number.isFinite(new Date(normalized).getTime());
}
export function isSanitizedCursorEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).some(key => !EVENT_FIELDS.has(key))) return false;
  if (event.taskContext !== undefined && (!event.taskContext || event.taskContext.method !== 'local-topic-rules-v1' || Object.keys(event.taskContext).some(key => !['method','topics'].includes(key)) || !Array.isArray(event.taskContext.topics) || event.taskContext.topics.length > 3 || event.taskContext.topics.some(topic => !CONTEXT_LABELS.includes(topic)))) return false;
  if (!validTimestamp(event.timestamp)) return false;
  if (event.model !== undefined && (typeof event.model !== 'string' || event.model.length > 120)) return false;
  if (event.conversationId !== undefined && event.conversationId !== null && (typeof event.conversationId !== 'string' || event.conversationId.length > 160)) return false;
  if (event.kind !== undefined && event.kind !== null && (typeof event.kind !== 'string' || event.kind.length > 100)) return false;
  if (event.isTokenBasedCall !== undefined && event.isTokenBasedCall !== null && typeof event.isTokenBasedCall !== 'boolean') return false;
  if (event.chargedCents !== undefined && !validAmount(event.chargedCents)) return false;
  if (event.cursorTokenFee !== undefined && !validAmount(event.cursorTokenFee)) return false;
  if (event.usageBasedCosts !== undefined && event.usageBasedCosts !== null && (typeof event.usageBasedCosts !== 'string' || event.usageBasedCosts.length > 50)) return false;
  if (event.workspaceRef !== undefined && event.workspaceRef !== null && (typeof event.workspaceRef !== 'string' || event.workspaceRef.length > 500 || /[\u0000-\u001f\u007f]/.test(event.workspaceRef))) return false;
  if (event.tokenUsage !== undefined && event.tokenUsage !== null) {
    if (typeof event.tokenUsage !== 'object' || Array.isArray(event.tokenUsage) || Object.keys(event.tokenUsage).some(key => !TOKEN_FIELDS.has(key))) return false;
    for (const key of ['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens']) if (event.tokenUsage[key] !== undefined && !validToken(event.tokenUsage[key])) return false;
    if (event.tokenUsage.totalCents !== undefined && !validAmount(event.tokenUsage.totalCents)) return false;
  }
  return true;
}

export function sanitizeCursorEvent(event, index) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Cursor returned an invalid event. Data was not saved.');
  const result = Object.fromEntries(['timestamp','model','conversationId','kind','isTokenBasedCall','chargedCents','usageBasedCosts','cursorTokenFee'].filter(key => event[key] !== undefined).map(key => [key,event[key]]));
  if (event.tokenUsage !== undefined && event.tokenUsage !== null && (typeof event.tokenUsage !== 'object' || Array.isArray(event.tokenUsage))) throw new Error('Cursor returned an invalid token usage value. Data was not saved.');
  if (event.tokenUsage !== undefined) {
    result.tokenUsage = event.tokenUsage === null ? null : Object.fromEntries(['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','totalCents'].filter(key => event.tokenUsage?.[key] !== undefined).map(key => [key,event.tokenUsage[key]]));
  }
  const workspace = index.get(event.conversationId);
  if (workspace) result.workspaceRef = workspace;
  const context = index.context?.get(event.conversationId);
  if (context) result.taskContext = context;
  if (!isSanitizedCursorEvent(result)) throw new Error('Cursor returned an invalid event field. Data was not saved.');
  return result;
}
