import test from 'node:test';
import assert from 'node:assert/strict';
import { browserBinding, browserProfileDirectory } from './browser-accounts.mjs';
import { EXPECTED_ACCOUNTS } from './accounts.mjs';
const email=EXPECTED_ACCOUNTS[0],identity={email,identityKey:'a'.repeat(64)};
test('browser conversion preserves existing ledger lineage without carrying desktop secret',()=>{
  const stored={email,identityKey:identity.identityKey,providerAccountRef:'b'.repeat(32),cookie:'never-copy-this'};
  const next=browserBinding(email,identity,stored);
  assert.equal(next.providerAccountRef,stored.providerAccountRef);assert.equal(next.transport,'chrome');assert.equal(next.profileDir,browserProfileDirectory(email));assert.equal('cookie' in next,false);
});
test('browser binding rejects wrong email and changed subject',()=>{
  const stored={email,identityKey:'c'.repeat(64),providerAccountRef:'b'.repeat(32)};
  assert.throws(()=>browserBinding(email,identity,stored));
  assert.throws(()=>browserBinding(email,{...identity,email:EXPECTED_ACCOUNTS[1]},null));
  assert.throws(()=>browserProfileDirectory('../arbitrary-profile'));
});
test('new browser identity is deterministic and dedicated profiles are separate',()=>{
  assert.equal(browserBinding(email,identity,null).providerAccountRef,browserBinding(email,identity,null).providerAccountRef);
  assert.equal(new Set(EXPECTED_ACCOUNTS.map(browserProfileDirectory)).size,4);
});
