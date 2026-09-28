import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { homedir } from 'node:os';

export const EXPECTED_ACCOUNTS = Object.freeze(['admin@mpdee.co.uk', 'mattduff36@gmail.com', 'matt.mpdee@gmail.com', 'mattduff36@hotmail.com']);
export const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const accountDirectory = () => path.join(process.env.LOCALAPPDATA || path.join(homedir(), '.local', 'share'), 'mpdee-accounts', 'cursor-accounts');

// DPAPI is bound to the current Windows user. Secrets travel only on child-process
// stdin/stdout, never arguments, environment variables, console output or Git files.
function crypt(value, decrypt = false) {
  if (process.platform !== 'win32') throw new Error('Protected account storage requires Windows DPAPI on this computer.');
  const command = decrypt
    ? "$value=[Console]::In.ReadToEnd(); $secure=ConvertTo-SecureString $value; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try {[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}"
    : "$value=[Console]::In.ReadToEnd(); [Console]::Write((ConvertTo-SecureString $value -AsPlainText -Force | ConvertFrom-SecureString))";
  // PowerShell 7 can pass incompatible Core module paths to Windows PowerShell.
  const env = { ...process.env }; delete env.PSModulePath;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { input:value, encoding:'utf8', windowsHide:true, timeout:15000, maxBuffer:100000, env });
  if (result.status !== 0 || !result.stdout) throw new Error('Protected local credential storage failed.');
  return result.stdout.trim();
}
export function saveAccountCredential(credentials, directory = accountDirectory()) {
  const email = normalizeEmail(credentials.email);
  if (!EXPECTED_ACCOUNTS.includes(email) || !/^[a-f0-9]{32}$/.test(credentials.providerAccountRef) || !/^[a-f0-9]{64}$/.test(credentials.identityKey ?? '') || !credentials.cookie) throw new Error('Unrecognized Cursor account identity.');
  mkdirSync(directory, { recursive:true, mode:0o700 });
  const target = path.join(directory, `${email}.dpapi`);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, crypt(JSON.stringify({ ...credentials, email })), { mode:0o600 });
  renameSync(temporary, target);
}
export function loadAccountCredential(email, directory = accountDirectory()) {
  if (!EXPECTED_ACCOUNTS.includes(email)) throw new Error('Unrecognized Cursor account.');
  try {
    const value = JSON.parse(crypt(readFileSync(path.join(directory, email + '.dpapi'), 'utf8'), true));
    if (!identityMatches(email, value, {email,identityKey:value?.identityKey}) || typeof value?.cookie !== 'string' || !value.cookie) throw new Error('Invalid stored binding.');
    return value;
  }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error('Stored Cursor account binding could not be read; preserve it for review.');
  } // Corruption must never permit replacement of an existing binding.
}
export function identityMatches(expectedEmail, credential, identity) {
  return normalizeEmail(credential?.email) === expectedEmail &&
    normalizeEmail(identity?.email) === expectedEmail &&
    /^[a-f0-9]{32}$/.test(credential?.providerAccountRef ?? '') &&
    /^[a-f0-9]{64}$/.test(credential?.identityKey ?? '') && identity?.identityKey === credential.identityKey;
}
export function bindCurrentCredential(expectedEmail, current, identity, stored) {
  if (!EXPECTED_ACCOUNTS.includes(expectedEmail) || normalizeEmail(current?.email) !== expectedEmail ||
      normalizeEmail(identity?.email) !== expectedEmail || !/^[a-f0-9]{32}$/.test(current?.providerAccountRef ?? '') ||
      !/^[a-f0-9]{64}$/.test(identity?.identityKey ?? '')) return null;
  if (stored && !identityMatches(expectedEmail, stored, identity)) return null;
  return { ...current, email:expectedEmail, identityKey:identity.identityKey,
    providerAccountRef:stored?.providerAccountRef ?? current.providerAccountRef };
}
export async function registerCurrentAccount({ current, load, verify, persist }) {
  const email = normalizeEmail(current?.email);
  if (!EXPECTED_ACCOUNTS.includes(email)) throw new Error('Desktop account is not an expected Cursor account.');
  const stored = await load(email);
  const identity = await verify(current);
  const bound = bindCurrentCredential(email, current, identity, stored);
  if (!bound) throw new Error('Cursor account identity conflicts with its saved binding; preserve it for review.');
  await persist(bound);
  return email;
}

export async function collectAllAccounts({ current, currentForAccount, load, verify, collect, persist = () => {}, now = () => new Date().toISOString() }) {
  const results = [];
  for (const email of EXPECTED_ACCOUNTS) {
    const result = { email, startedAt:now(), state:'identity_unverified' };
    try {
      const active = currentForAccount ? await currentForAccount(email) : current;
      const isCurrent = normalizeEmail(active?.email) === email;
      const stored = await load(email);
      let credential = isCurrent ? active : stored;
      if (!credential) result.state = 'missing_session';
      if (credential) {
        result.state = 'identity_unverified';
        let identity;
        let usingCurrent = isCurrent;
        try { identity = await verify(credential); }
        catch (error) {
          if (!isCurrent || !stored) throw error;
          credential = stored;
          usingCurrent = false;
          identity = await verify(stored);
        }
        if (usingCurrent) credential = bindCurrentCredential(email, active, identity, stored);
        if (!identityMatches(email, credential, identity)) result.state = 'identity_mismatch';
        else {
          // Registration is deliberately before collection: a provider outage must
          // not lose an already verified account when the desktop switches users.
          await persist(credential);
          result.state = 'collection_failed';
          const coverage = await collect(credential);
          if (validDate(coverage?.coveredThrough)) result.coveredThrough = coverage.coveredThrough;
          if (typeof coverage?.catchingUp === 'boolean') result.catchingUp = coverage.catchingUp;
          result.state = 'success';
          result.accountRef = credential.providerAccountRef;
        }
      }
    } catch (error) {
      // Copy only validated progress, never provider error text or credentials.
      if (result.state === 'collection_failed') {
        if (validDate(error?.coverage?.coveredThrough)) result.coveredThrough = error.coverage.coveredThrough;
        if (typeof error?.coverage?.catchingUp === 'boolean') result.catchingUp = error.coverage.catchingUp;
      }
    }
    result.finishedAt = now();
    if (result.state === 'success') result.lastSuccessAt = result.finishedAt;
    results.push(result);
  }
  return { version:1, expected:EXPECTED_ACCOUNTS.length, succeeded:results.filter(r => r.state === 'success').length, finishedAt:now(), accounts:results };
}
/** Collect only the account currently signed into the default Cursor desktop. */
export async function collectActiveAccount({ current, load, verify, collect, persist = () => {}, now = () => new Date().toISOString() }) {
  const activeEmail = normalizeEmail(current?.email);
  const activeAccount = EXPECTED_ACCOUNTS.includes(activeEmail) ? activeEmail : undefined;
  const accounts = EXPECTED_ACCOUNTS.map(email => ({ email, startedAt:now(), state:'inactive', finishedAt:now() }));
  if (activeAccount) {
    const result = accounts.find(account => account.email === activeAccount);
    result.state = 'identity_unverified';
    try {
      // Read the saved binding only to preserve identity and historical keys.
      // Never use its session as a fallback or probe another account's session.
      const stored = await load(activeAccount);
      const identity = await verify(current);
      const bound = bindCurrentCredential(activeAccount, current, identity, stored);
      if (!bound || !identityMatches(activeAccount, bound, identity)) result.state = 'identity_mismatch';
      else {
        await persist(bound);
        result.state = 'collection_failed';
        const coverage = await collect(bound);
        if (validDate(coverage?.coveredThrough)) result.coveredThrough = coverage.coveredThrough;
        if (typeof coverage?.catchingUp === 'boolean') result.catchingUp = coverage.catchingUp;
        result.accountRef = bound.providerAccountRef;
        result.state = 'success';
      }
    } catch (error) {
      if (result.state === 'collection_failed') {
        if (validDate(error?.coverage?.coveredThrough)) result.coveredThrough = error.coverage.coveredThrough;
        if (typeof error?.coverage?.catchingUp === 'boolean') result.catchingUp = error.coverage.catchingUp;
      }
    }
    result.finishedAt = now();
    if (result.state === 'success') result.lastSuccessAt = result.finishedAt;
  }
  return { version:1, expected:EXPECTED_ACCOUNTS.length, mode:'active_account',
    ...(activeAccount ? {activeAccount} : {}), succeeded:accounts.filter(account => account.state === 'success').length,
    finishedAt:now(), accounts };
}

export function saveAccountStatus(directory, status) {
  const target = path.join(directory, 'accounts-status.json');
  let previous;
  try { previous = JSON.parse(readFileSync(target, 'utf8')); } catch { /* History is optional; never recover secrets or arbitrary fields. */ }
  for (const account of status.accounts) {
    const prior = Array.isArray(previous?.accounts) ? previous.accounts.find(item => item?.email === account.email) : null;
    for (const key of ['lastSuccessAt', 'coveredThrough']) {
      if (!validDate(account[key]) && validDate(prior?.[key])) account[key] = prior[key];
    }
    if (typeof account.catchingUp !== 'boolean' && typeof prior?.catchingUp === 'boolean') account.catchingUp = prior.catchingUp;
  }
  if (status.uploadState === 'success') status.lastUploadSuccessAt = status.finishedAt;
  else if (validDate(previous?.lastUploadSuccessAt)) status.lastUploadSuccessAt = previous.lastUploadSuccessAt;
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(status, null, 2), { mode:0o600 });
  renameSync(temporary, target);
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}
