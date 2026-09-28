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

export async function collectAllAccounts({ current, load, verify, collect, persist = () => {}, now = () => new Date().toISOString() }) {
  const results = [];
  for (const email of EXPECTED_ACCOUNTS) {
    const result = { email, startedAt:now(), state:'identity_unverified' };
    try {
      const isCurrent = normalizeEmail(current?.email) === email;
      const stored = await load(email);
      let credential = isCurrent ? current : stored;
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
        if (usingCurrent) credential = bindCurrentCredential(email, current, identity, stored);
        if (!identityMatches(email, credential, identity)) result.state = 'identity_mismatch';
        else {
          // Registration is deliberately before collection: a provider outage must
          // not lose an already verified account when the desktop switches users.
          await persist(credential);
          result.state = 'collection_failed';
          await collect(credential);
          result.state = 'success';
          result.accountRef = credential.providerAccountRef;
        }
      }
    } catch { /* Report only fixed status strings; provider errors may contain secrets. */ }
    result.finishedAt = now();
    results.push(result);
  }
  return { version:1, expected:EXPECTED_ACCOUNTS.length, succeeded:results.filter(r => r.state === 'success').length, finishedAt:now(), accounts:results };
}
export function saveAccountStatus(directory, status) {
  const target = path.join(directory, 'accounts-status.json');
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(status, null, 2), { mode:0o600 });
  renameSync(temporary, target);
}
