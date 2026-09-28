import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { accountDirectory, EXPECTED_ACCOUNTS, normalizeEmail } from './accounts.mjs';
import { readCursorCredentials } from './cursor-adapter.mjs';

function expectedAccount(email) {
  const normalized = normalizeEmail(email);
  if (!EXPECTED_ACCOUNTS.includes(normalized)) throw new Error('Unrecognized Cursor desktop account.');
  return normalized;
}

function profilePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') ||
      (process.platform === 'win32' && !/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i.test(value))) {
    throw new Error('Cursor desktop profile must be an absolute directory.');
  }
  const normalized = path.normalize(value);
  return normalized.length > path.parse(normalized).root.length ? normalized.replace(/[\\/]+$/, '') : normalized;
}

const pathIdentity = value => process.platform === 'win32' ? value.toLowerCase() : value;

function validateProfiles(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid desktop profile registry.');
  const profiles = {};
  const paths = new Set();
  for (const [email, directory] of Object.entries(value)) {
    if (expectedAccount(email) !== email) throw new Error('Invalid desktop profile account.');
    const normalized = profilePath(directory);
    const identity = pathIdentity(normalized);
    if (paths.has(identity)) throw new Error('Cursor desktop profile is assigned to more than one account.');
    paths.add(identity);
    profiles[email] = normalized;
  }
  return profiles;
}

/** Nonsecret account-to-directory bindings only. Corrupt registries fail closed. */
export function loadDesktopProfiles(directory = accountDirectory()) {
  let raw;
  try { raw = readFileSync(path.join(directory, 'desktop-profiles.json'), 'utf8'); }
  catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw new Error('Desktop profile registry could not be read; preserve it for review.');
  }
  try { return validateProfiles(JSON.parse(raw)); }
  catch { throw new Error('Desktop profile registry is invalid; preserve it for review.'); }
}

/** Validate registration before verifying or persisting any session credentials. */
export function validateDesktopProfileBinding(email, userDataDir, directory = accountDirectory()) {
  email = expectedAccount(email);
  const targetPath = profilePath(userDataDir);
  const profiles = loadDesktopProfiles(directory);
  if (profiles[email] && pathIdentity(profiles[email]) !== pathIdentity(targetPath)) {
    throw new Error('Cursor desktop profile conflicts with its existing binding; preserve it for review.');
  }
  return validateProfiles({ ...profiles, [email]: profiles[email] ?? targetPath });
}

export function saveDesktopProfile(email, userDataDir, directory = accountDirectory()) {
  const next = validateDesktopProfileBinding(email, userDataDir, directory);
  mkdirSync(directory, { recursive:true, mode:0o700 });
  const target = path.join(directory, 'desktop-profiles.json');
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode:0o600 });
  renameSync(temporary, target);
  return next;
}

/** A local candidate only: callers MUST verify provider identity before use. */
export function readDesktopCredentialsForAccount(email, profiles, read = readCursorCredentials) {
  email = expectedAccount(email);
  const directory = validateProfiles(profiles)[email];
  if (!directory || !existsSync(path.join(directory, 'User', 'globalStorage', 'state.vscdb'))) return null;
  let candidate;
  try { candidate = read(directory); }
  catch { return null; } // A retained session may still verify when local SQLite is unavailable.
  if (!candidate) return null;
  if (normalizeEmail(candidate.email) !== email) throw new Error('Cursor desktop profile account does not match its configured account.');
  return { ...candidate, email };
}
