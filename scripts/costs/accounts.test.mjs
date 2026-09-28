import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPECTED_ACCOUNTS, collectAllAccounts, identityMatches, registerCurrentAccount, loadAccountCredential, saveAccountStatus } from './accounts.mjs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const credential = index => ({ email:EXPECTED_ACCOUNTS[index], providerAccountRef:String(index).repeat(32), identityKey:String(index).repeat(64), cookie:'private-test-value' });
const identity = value => ({ email:value.email, identityKey:value.identityKey });
test('all four independent accounts collect under their stable identities', async () => {
  const seen = [], persisted = [];
  const result = await collectAllAccounts({ current:credential(0), load:email => credential(EXPECTED_ACCOUNTS.indexOf(email)), verify:identity,
    persist:value => persisted.push(value.email), collect:value => seen.push(value.providerAccountRef) });
  assert.equal(result.succeeded,4); assert.equal(new Set(seen).size,4); assert.equal(persisted.length,4);
  assert.equal(JSON.stringify(result).includes('private-test-value'),false);
});
test('missing and failed accounts never mask healthy accounts or report aggregate success', async () => {
  const seen=[];
  const result=await collectAllAccounts({ current:credential(0), load:email => email===EXPECTED_ACCOUNTS[2] ? null : credential(EXPECTED_ACCOUNTS.indexOf(email)), verify:identity,
    collect:value => { if(value.email===EXPECTED_ACCOUNTS[1]) throw new Error('private-test-value'); seen.push(value.email); } });
  assert.equal(result.succeeded,2); assert.deepEqual(seen,[EXPECTED_ACCOUNTS[0],EXPECTED_ACCOUNTS[3]]);
  assert.deepEqual(result.accounts.map(r=>r.state),['success','collection_failed','missing_session','success']);
  assert.equal(JSON.stringify(result).includes('private-test-value'),false);
});
test('stale cached email or wrong stable identity cannot advance collection/checkpoint', async () => {
  const seen=[];
  const result=await collectAllAccounts({ current:credential(0), load:email=>credential(EXPECTED_ACCOUNTS.indexOf(email)),
    verify:value=>value.email===EXPECTED_ACCOUNTS[0] ? identity(credential(1)) : {...identity(value),identityKey:'f'.repeat(64)}, collect:value=>seen.push(value) });
  assert.equal(result.succeeded,0); assert.equal(seen.length,0); assert.ok(result.accounts.every(r=>r.state==='identity_mismatch'));
  assert.equal(identityMatches(EXPECTED_ACCOUNTS[0],credential(0),{email:EXPECTED_ACCOUNTS[0]}),false);
});
test('expired session identity failure is isolated and never leaks provider exception', async()=> {
  const result=await collectAllAccounts({ current:null, load:email=>credential(EXPECTED_ACCOUNTS.indexOf(email)), verify:value=>{if(value.email===EXPECTED_ACCOUNTS[1])throw new Error(value.cookie); return identity(value);},collect:()=>{} });
  assert.equal(result.succeeded,3); assert.equal(result.accounts[1].state,'identity_unverified'); assert.ok(!JSON.stringify(result).includes('private-test-value'));
});
test('initial desktop identity binding preserves historical account reference',async()=>{
  const current={...credential(0)}; delete current.identityKey;
  let saved;
  const result=await collectAllAccounts({current,load:()=>null,verify:()=>identity(credential(0)),persist:value=>{saved=value;},collect:()=>{}});
  assert.equal(result.succeeded,1); assert.equal(saved.providerAccountRef,current.providerAccountRef); assert.equal(saved.identityKey,credential(0).identityKey);
});
test('retained credentials without a bound identity are held even if email matches',async()=>{
  let collected=0;
  const result=await collectAllAccounts({current:null,load:email=>({email,providerAccountRef:'a'.repeat(32),cookie:'private-test-value'}),verify:()=>identity(credential(0)),collect:()=>{collected++;}});
  assert.equal(collected,0); assert.equal(result.succeeded,0);
});
test('changed subject under same email is rejected in collection and explicit registration',async()=>{
  const stored=credential(0), current={...stored,identityKey:'f'.repeat(64)};
  let writes=0, collections=0;
  const load=email=>email===stored.email?stored:null;
  const verify=()=>identity(current);
  const result=await collectAllAccounts({current,load,verify,persist:()=>writes++,collect:()=>collections++});
  assert.equal(result.accounts[0].state,'identity_mismatch'); assert.equal(writes,0); assert.equal(collections,0);
  await assert.rejects(registerCurrentAccount({current,load,verify,persist:()=>writes++})); assert.equal(writes,0);
});
test('same subject session rotation keeps saved accountRef for collection and registration',async()=>{
  const stored=credential(0),current={...stored,providerAccountRef:'b'.repeat(32),cookie:'new-session'};
  const load=email=>email===stored.email?stored:null, saved=[],seen=[];
  await collectAllAccounts({current,load,verify:identity,persist:value=>saved.push(value),collect:value=>seen.push(value)});
  await registerCurrentAccount({current,load,verify:identity,persist:value=>saved.push(value)});
  assert.equal(saved.length,2); assert.ok(saved.every(value=>value.providerAccountRef===stored.providerAccountRef && value.cookie==='new-session'));
  assert.equal(seen[0].providerAccountRef,stored.providerAccountRef);
});
test('failed current authentication uses verified retained session with pinned identity',async()=>{
  const stored=credential(0),current={...stored,cookie:'expired'};let seen;
  const result=await collectAllAccounts({current,load:email=>email===stored.email?stored:null,verify:value=>{if(value.cookie==='expired')throw new Error('expired');return identity(value);},collect:value=>{seen=value;}});
  assert.equal(result.accounts[0].state,'success');assert.equal(seen.cookie,stored.cookie);
});
test('unreadable existing binding blocks capture and collection without overwriting it',async()=>{
  let writes=0;const load=()=>{throw new Error('protected store error');};
  const result=await collectAllAccounts({current:credential(0),load,verify:identity,persist:()=>writes++,collect:()=>{throw new Error('must not collect');}});
  assert.equal(result.succeeded,0);assert.ok(result.accounts.every(value=>value.state==='identity_unverified'));
  await assert.rejects(registerCurrentAccount({current:credential(0),load,verify:identity,persist:()=>writes++}));assert.equal(writes,0);
});
test('independent desktop candidates rotate sessions without rekeying accounts',async()=>{
  const seen=[];
  const result=await collectAllAccounts({current:null,currentForAccount:email=>({...credential(EXPECTED_ACCOUNTS.indexOf(email)),providerAccountRef:'f'.repeat(32)}),load:email=>credential(EXPECTED_ACCOUNTS.indexOf(email)),verify:identity,collect:value=>seen.push(value.providerAccountRef)});
  assert.equal(result.succeeded,4);assert.equal(new Set(seen).size,4);
});

test('profile read failures isolate accounts and retain sanitized partial coverage',async()=>{
  const result=await collectAllAccounts({currentForAccount:email=>{if(email===EXPECTED_ACCOUNTS[0])throw new Error('private-test-value');return credential(EXPECTED_ACCOUNTS.indexOf(email));},load:()=>null,verify:identity,collect:()=>{const error=new Error('private-test-value');error.coverage={coveredThrough:'2026-09-01T00:00:00.000Z',catchingUp:true,cookie:'private-test-value'};throw error;}});
  assert.equal(result.succeeded,0);assert.equal(result.accounts[0].state,'identity_unverified');assert.equal(result.accounts[1].coveredThrough,'2026-09-01T00:00:00.000Z');assert.equal(result.accounts[1].catchingUp,true);assert.ok(!JSON.stringify(result).includes('private-test-value'));
});

test('failed runs preserve last success and new partial coverage without leaking arbitrary fields',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'cursor-health-'));
  try {
    const first={finishedAt:'2026-09-27T10:00:00.000Z',uploadState:'success',accounts:[{email:EXPECTED_ACCOUNTS[0],state:'success',lastSuccessAt:'2026-09-27T10:00:00.000Z',coveredThrough:'2026-09-20T00:00:00.000Z',catchingUp:true}]};
    saveAccountStatus(directory,first);
    const next={finishedAt:'2026-09-28T10:00:00.000Z',uploadState:'failed',accounts:[{email:EXPECTED_ACCOUNTS[0],state:'collection_failed',coveredThrough:'2026-09-23T00:00:00.000Z',catchingUp:true}]};
    saveAccountStatus(directory,next);
    const saved=JSON.parse(readFileSync(path.join(directory,'accounts-status.json'),'utf8'));
    assert.equal(saved.lastUploadSuccessAt,first.finishedAt);
    assert.equal(saved.accounts[0].lastSuccessAt,first.finishedAt);
    assert.equal(saved.accounts[0].coveredThrough,next.accounts[0].coveredThrough);
    assert.equal(saved.accounts[0].catchingUp,true);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
