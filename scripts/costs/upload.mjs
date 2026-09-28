import { retryTransient } from './reliability.mjs';

export async function sendUpload(endpoint, token, body, bypassToken = null) {
  if (bypassToken && (endpoint.hostname !== 'mpdee-accounts2-git-preview-mpdees-projects.vercel.app' || endpoint.port)) throw new Error('Vercel protection bypass is only allowed for the configured Accounts preview host.');
  const headers = {'Content-Type':'application/json',Authorization:`Bearer ${token}`};
  if (bypassToken) headers['x-vercel-protection-bypass'] = bypassToken;
  return retryTransient(async () => {
    let response;
    try {
      response = await fetch(endpoint, { method:'POST', redirect:'error', signal:AbortSignal.timeout(65_000), headers, body });
    } catch {
      const error = new Error('Accounts import request failed or timed out; local outbox file retained for retry.');
      error.transient = true;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`Accounts import returned HTTP ${response.status}; local outbox file retained for retry.`);
      error.transient = response.status === 429 || response.status >= 500;
      throw error;
    }
    let acknowledgement;
    try { acknowledgement = await response.json(); }
    catch { throw new Error('Accounts import returned an invalid acknowledgement; local outbox file retained for retry.'); }
    return { ok:true, acknowledgement };
  });
}
