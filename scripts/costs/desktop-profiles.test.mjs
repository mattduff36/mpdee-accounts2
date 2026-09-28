import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readCursorCredentials } from './cursor-adapter.mjs';
import { loadDesktopProfiles, saveDesktopProfile, readDesktopCredentialsForAccount, validateDesktopProfileBinding } from './desktop-profiles.mjs';
import { collectAllAccounts } from './accounts.mjs';

const GMAIL = 'mattduff36@gmail.com';
const OTHER = 'matt.mpdee@gmail.com';
function fixture(t, email = GMAIL) {
  const root = mkdtempSync(path.join(tmpdir(), 'costs-desktop-profile-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const profile = path.join(root, 'profile');
  const folder = path.join(profile, 'User', 'globalStorage');
  mkdirSync(folder, {recursive:true});
  const databaseFile = path.join(folder, 'state.vscdb');
  const db = new DatabaseSync(databaseFile);
  db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
  const insert = db.prepare('INSERT INTO ItemTable VALUES (?, ?)');
  insert.run('cursorAuth/accessToken', 'fixture-token');
  insert.run('cursorAuth/stripeMembershipAuthId', 'fixture-auth');
  insert.run('cursorAuth/cachedEmail', email);
  db.close();
  return {root, profile, databaseFile, registry:path.join(root, 'registry')};
}

test('explicit desktop profile reads its SQLite fixture without changing bytes', t => {
  const {profile, databaseFile} = fixture(t);
  const before = readFileSync(databaseFile);
  const candidate = readCursorCredentials(profile);
  assert.equal(candidate.email, GMAIL);
  assert.match(candidate.providerAccountRef, /^[a-f0-9]{32}$/);
  assert.equal(candidate.cookie, 'WorkosCursorSessionToken=fixture-auth%3A%3Afixture-token');
  assert.deepEqual(readFileSync(databaseFile), before);
});

test('explicit path never falls back to default profile or creates a missing database', t => {
  const {root} = fixture(t);
  assert.throws(() => readCursorCredentials('relative-profile'), /absolute directory/);
  if (process.platform === 'win32') assert.throws(() => readCursorCredentials('\\drive-dependent'), /absolute directory/);
  const absent = path.join(root, 'absent');
  assert.throws(() => readCursorCredentials(absent));
  assert.equal(existsSync(absent), false);
  assert.equal(readDesktopCredentialsForAccount(GMAIL, {[GMAIL]:absent}), null);
});

test('omitting profile retains the original APPDATA Cursor location', t => {
  const {root, profile} = fixture(t);
  cpSync(profile, path.join(root, 'Cursor'), {recursive:true});
  const original = process.env.APPDATA;
  process.env.APPDATA = root;
  try { assert.equal(readCursorCredentials().email, GMAIL); }
  finally {
    if (original === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = original;
  }
});

test('registry persists nonsecret account directory bindings and preserves existing bindings', t => {
  const {profile, registry, root} = fixture(t);
  assert.deepEqual(loadDesktopProfiles(registry), {});
  saveDesktopProfile(GMAIL, profile, registry);
  assert.deepEqual(loadDesktopProfiles(registry), {[GMAIL]:profile});
  saveDesktopProfile(GMAIL.toUpperCase(), profile, registry);
  assert.throws(() => saveDesktopProfile(GMAIL, path.join(root, 'different'), registry), /existing binding/);
  assert.throws(() => saveDesktopProfile(OTHER, profile, registry), /more than one account/);
  assert.throws(() => saveDesktopProfile(OTHER, profile + path.sep, registry), /more than one account/);
  assert.throws(() => saveDesktopProfile('unexpected@example.com', profile, registry), /Unrecognized/);
  assert.throws(() => saveDesktopProfile(OTHER, 'relative', registry), /absolute/);
  assert.equal(readFileSync(path.join(registry, 'desktop-profiles.json'), 'utf8').includes('fixture-token'), false);
});

test('configured candidate requires cached account match and still has no verified identity', t => {
  const {profile} = fixture(t);
  const candidate = readDesktopCredentialsForAccount(GMAIL, {[GMAIL]:profile});
  assert.equal(candidate.email, GMAIL);
  assert.equal(candidate.identityKey, undefined);
  assert.throws(() => readDesktopCredentialsForAccount(OTHER, {[OTHER]:profile}), /does not match/);
  assert.equal(readDesktopCredentialsForAccount(OTHER, {[GMAIL]:profile}), null);
});

test('corrupt or credential-shaped registry is never replaced', t => {
  const {registry, profile} = fixture(t);
  mkdirSync(registry);
  const file = path.join(registry, 'desktop-profiles.json');
  for (const bad of ['{', JSON.stringify({[GMAIL]:{cookie:'fake'}}), JSON.stringify({[GMAIL]:profile,[OTHER]:profile})]) {
    writeFileSync(file, bad);
    assert.throws(() => loadDesktopProfiles(registry), /invalid/);
    assert.throws(() => saveDesktopProfile(GMAIL, profile, registry), /invalid/);
    assert.equal(readFileSync(file, 'utf8'), bad);
  }
});

test('profile read failures allow independently verified retained-session fallback', async t => {
  const {profile} = fixture(t);
  const stored = {email:GMAIL,providerAccountRef:'a'.repeat(32),identityKey:'b'.repeat(64),cookie:'fixture-only'};
  const candidate = email => readDesktopCredentialsForAccount(email, {[GMAIL]:profile}, () => {throw new Error('private detail');});
  assert.equal(candidate(GMAIL), null);
  let collections = 0;
  const result = await collectAllAccounts({current:null,currentForAccount:candidate,load:email=>email===GMAIL?stored:null,verify:async credential=>({email:credential.email,identityKey:stored.identityKey}),collect:async()=>{collections++;}});
  assert.equal(collections,1);
  assert.equal(result.accounts.find(a=>a.email===GMAIL).state,'success');
  assert.equal(JSON.stringify(result).includes('private detail'),false);
  const mismatch = await collectAllAccounts({current:null,currentForAccount:email=>readDesktopCredentialsForAccount(email,{[OTHER]:profile}),load:email=>email===OTHER?{...stored,email:OTHER}:null,verify:async()=>assert.fail('wrong-account profile must not verify saved fallback'),collect:async()=>assert.fail('must not collect')});
  assert.notEqual(mismatch.accounts.find(a=>a.email===OTHER).state,'success');
});

test('registration preflight rejects conflicts without changing registry or retained credentials', t => {
  const {profile, registry, root} = fixture(t);
  assert.deepEqual(validateDesktopProfileBinding(GMAIL,profile,registry),{[GMAIL]:profile});
  assert.equal(existsSync(registry),false,'preflight must not create files');
  saveDesktopProfile(GMAIL,profile,registry);
  const credentialFile=path.join(registry,GMAIL+'.dpapi');
  writeFileSync(credentialFile,'fixture-protected-session');
  const registryFile=path.join(registry,'desktop-profiles.json');
  const before=readFileSync(registryFile,'utf8');
  assert.throws(()=>validateDesktopProfileBinding(GMAIL,path.join(root,'replacement'),registry),/existing binding/);
  assert.throws(()=>validateDesktopProfileBinding(OTHER,profile,registry),/more than one account/);
  assert.equal(readFileSync(registryFile,'utf8'),before);
  assert.equal(readFileSync(credentialFile,'utf8'),'fixture-protected-session');
  writeFileSync(registryFile,'{');
  assert.throws(()=>validateDesktopProfileBinding(GMAIL,profile,registry),/invalid/);
  assert.equal(readFileSync(registryFile,'utf8'),'{');
  assert.equal(readFileSync(credentialFile,'utf8'),'fixture-protected-session');
});
