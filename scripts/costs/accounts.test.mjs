import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPECTED_ACCOUNTS, collectAllAccounts, collectActiveAccount, identityMatches, registerCurrentAccount, loadAccountCredential, saveAccountStatus, loadAccountStatus } from './accounts.mjs';
import { saveCheckpoint, loadCheckpoint, DAY_MS, flushOutbox } from './reliability.mjs';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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
    saveAccountStatus(directory,first,{uploaded:1,uploadFinishedAt:first.finishedAt});
    const next={finishedAt:'2026-09-28T10:00:00.000Z',uploadState:'failed',accounts:[{email:EXPECTED_ACCOUNTS[0],state:'collection_failed',coveredThrough:'2026-09-23T00:00:00.000Z',catchingUp:true}]};
    saveAccountStatus(directory,next);
    const saved=JSON.parse(readFileSync(path.join(directory,'accounts-status.json'),'utf8'));
    assert.equal(saved.lastUploadSuccessAt,first.finishedAt);
    assert.equal(saved.accounts[0].lastSuccessAt,first.finishedAt);
    assert.equal(saved.accounts[0].coveredThrough,next.accounts[0].coveredThrough);
    assert.equal(saved.accounts[0].catchingUp,true);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test('active mode probes only the default desktop account and preserves its stable reference across rotation',async()=>{
  const stored=credential(1), current={...stored,providerAccountRef:'f'.repeat(32),cookie:'rotated-fixture-session'};
  const loaded=[],verified=[],saved=[],collected=[];
  const result=await collectActiveAccount({current,load:email=>{loaded.push(email);return stored;},verify:value=>{verified.push(value);return identity(value);},persist:value=>saved.push(value),collect:value=>collected.push(value)});
  assert.deepEqual(loaded,[stored.email]);assert.equal(verified.length,1);assert.equal(verified[0],current);
  assert.equal(result.mode,'active_account');assert.equal(result.expected,4);assert.equal(result.activeAccount,stored.email);assert.equal(result.succeeded,1);
  assert.deepEqual(result.accounts.map(a=>a.state),['inactive','success','inactive','inactive']);
  assert.equal(saved[0].providerAccountRef,stored.providerAccountRef);assert.equal(collected[0].providerAccountRef,stored.providerAccountRef);
  assert.equal(JSON.stringify(result).includes('rotated-fixture-session'),false);
});

test('unsupported or absent active account makes no stored-session or provider requests',async()=>{
  for(const current of [null,{...credential(0),email:'unsupported@example.com'}]){
    const forbidden=()=>assert.fail('inactive account must not be contacted');
    const result=await collectActiveAccount({current,load:forbidden,verify:forbidden,persist:forbidden,collect:forbidden});
    assert.equal(result.succeeded,0);assert.equal('activeAccount' in result,false);assert.ok(result.accounts.every(a=>a.state==='inactive'));
  }
});

test('active identity failure never falls back to retained sessions or mutates other accounts',async()=>{
  let verifications=0;
  const forbidden=()=>assert.fail('failed identity must not persist or collect');
  const result=await collectActiveAccount({current:credential(2),load:email=>{assert.equal(email,EXPECTED_ACCOUNTS[2]);return credential(2);},verify:()=>{verifications++;throw new Error('private-test-value');},persist:forbidden,collect:forbidden});
  assert.equal(verifications,1);assert.equal(result.succeeded,0);assert.equal(result.accounts[2].state,'identity_unverified');
  assert.ok(result.accounts.filter((_,i)=>i!==2).every(a=>a.state==='inactive'));assert.ok(!JSON.stringify(result).includes('private-test-value'));
  for(const mismatched of [identity(credential(1)),{...identity(credential(2)),identityKey:'f'.repeat(64)}]){
    const mismatch=await collectActiveAccount({current:credential(2),load:()=>credential(2),verify:()=>mismatched,persist:forbidden,collect:forbidden});
    assert.equal(mismatch.accounts[2].state,'identity_mismatch');
  }
});

test('switching active accounts maintains separate checkpoints and inactive account history',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'cursor-active-switch-'));
  try {
    const bindings=new Map();
    const run=(index,day)=>collectActiveAccount({current:credential(index),load:email=>bindings.get(email)??null,verify:identity,persist:value=>bindings.set(value.email,value),now:()=>new Date(day*DAY_MS).toISOString(),collect:value=>{
      assert.equal(loadCheckpoint(directory,value.providerAccountRef),null);
      saveCheckpoint(directory,value.providerAccountRef,day*DAY_MS);
      return {coveredThrough:new Date(day*DAY_MS).toISOString(),catchingUp:false};
    }});
    const first=await run(0,100);saveAccountStatus(directory,first);
    const second=await run(1,101);saveAccountStatus(directory,second);
    assert.equal(loadCheckpoint(directory,credential(0).providerAccountRef),100*DAY_MS);
    assert.equal(loadCheckpoint(directory,credential(1).providerAccountRef),101*DAY_MS);
    assert.equal(second.accounts[0].state,'inactive');assert.equal(second.accounts[0].lastSuccessAt,first.accounts[0].lastSuccessAt);
    assert.equal(second.accounts[0].coveredThrough,first.accounts[0].coveredThrough);
    assert.equal(second.succeeded,1);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('active collection failure preserves safe progress without exposing errors',async()=>{
  const result=await collectActiveAccount({current:credential(3),load:()=>null,verify:identity,collect:()=>{const error=new Error('private-test-value');error.coverage={coveredThrough:'2026-09-01T00:00:00.000Z',catchingUp:true,cookie:'private-test-value'};throw error;}});
  assert.equal(result.accounts[3].state,'collection_failed');assert.equal(result.accounts[3].coveredThrough,'2026-09-01T00:00:00.000Z');
  assert.equal(result.accounts[3].catchingUp,true);assert.equal(result.succeeded,0);assert.ok(!JSON.stringify(result).includes('private-test-value'));
});

async function completedStatus() {
  return {...await collectActiveAccount({current:credential(0),load:()=>null,verify:identity,collect:()=>({coveredThrough:'2026-09-27T00:00:00.000Z',catchingUp:false}),now:()=> '2026-09-27T10:00:00.000Z'}),uploadState:'failed'};
}

test('upload-only retry advances upload time without changing collection freshness or copying arbitrary fields',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'cursor-flush-status-'));
  try {
    const original=await completedStatus();
    const contaminated={...original,cookie:'private-secret',accounts:original.accounts.map(a=>({...a,prompt:'private-prompt',token:'private-token'}))};
    writeFileSync(path.join(directory,'accounts-status.json'),JSON.stringify(contaminated));
    const status=loadAccountStatus(directory,Date.parse('2026-09-29T12:00:00.000Z'));
    assert.deepEqual(status,original);
    status.uploadState='success';
    const completion='2026-09-29T12:00:00.000Z';
    saveAccountStatus(directory,status,{uploaded:1,uploadFinishedAt:completion});
    const published=loadAccountStatus(directory,Date.parse(completion));
    assert.equal(published.lastUploadSuccessAt,completion);
    assert.equal(published.finishedAt,original.finishedAt);
    assert.deepEqual(published.accounts,original.accounts);
    assert.ok(!JSON.stringify(published).includes('private-'));
    status.uploadState='failed';
    saveAccountStatus(directory,status,{uploadFinishedAt:'2026-09-30T12:00:00.000Z'});
    assert.equal(loadAccountStatus(directory,Date.parse('2026-09-30T12:00:00.000Z')).lastUploadSuccessAt,completion);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('invalid prior reports fail closed for malformed known fields and inconsistent identities',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'cursor-status-validation-'));
  try {
    const valid=await completedStatus(),now=Date.parse('2026-09-29T12:00:00.000Z');
    assert.equal(loadAccountStatus(directory,now),null);
    const broken=[
      '{private-invalid-json',
      JSON.stringify({...valid,finishedAt:'2026-02-30T10:00:00.000Z'}),
      JSON.stringify({...valid,finishedAt:'2099-01-01T00:00:00.000Z'}),
      JSON.stringify({...valid,mode:'private-secret'}),
      JSON.stringify({...valid,succeeded:2}),
      JSON.stringify({...valid,accounts:[valid.accounts[0],valid.accounts[0],...valid.accounts.slice(2)]}),
      JSON.stringify({...valid,accounts:valid.accounts.map((a,i)=>i===0?{...a,accountRef:'private-secret'}:a)}),
      JSON.stringify({...valid,accounts:valid.accounts.map((a,i)=>i===1?{...a,email:'other@example.com'}:a)}),
      JSON.stringify({...valid,accounts:valid.accounts.map((a,i)=>i===1?{...a,state:'success'}:a)}),
      JSON.stringify({...valid,accounts:valid.accounts.map((a,i)=>i===1?{...a,catchingUp:'private-secret'}:a)}),
      JSON.stringify({...valid,accounts:valid.accounts.map((a,i)=>i===0?{...a,startedAt:'2026-09-28T00:00:00.000Z'}:a)}),
      JSON.stringify({...valid,accounts:valid.accounts.map((a,i)=>i===0?{...a,coveredThrough:{token:'private-secret'}}:a)}),
      JSON.stringify({...valid,extra:'x'.repeat(17000)}),
    ];
    for(const raw of broken){writeFileSync(path.join(directory,'accounts-status.json'),raw);assert.equal(loadAccountStatus(directory,now),null);}
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('invalid collection status does not block sanitized queued usage uploads',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'cursor-flush-invalid-status-'));
  try {
    writeFileSync(path.join(directory,'accounts-status.json'),'{private-secret');
    const status=loadAccountStatus(directory);
    assert.equal(status,null);
    const payload={version:'mpdee-costs-v1',provider:'cursor',accountRef:'a'.repeat(32),quality:'complete',events:[]};
    writeFileSync(path.join(directory,`${payload.accountRef}-1-2.json`),JSON.stringify(payload));
    let calls=0;
    const result=await flushOutbox({directory,endpoint:new URL('https://example.invalid/api/costs/ingest'),token:'fixture-only',send:async(_url,_token,body)=>{
      calls++;assert.deepEqual(JSON.parse(body),payload);assert.ok(!body.includes('private-secret'));
      return {ok:true,acknowledgement:{received:0,added:0,revised:0,duplicate:0,unassigned:0,quality:'complete'}};
    }});
    assert.deepEqual(result,{uploaded:1,skipped:0,failed:0});assert.equal(calls,1);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('empty and acknowledged queues do not invent new usage upload timestamps',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'cursor-upload-timestamp-'));
  try {
    const status=await completedStatus();
    const endpoint=new URL('https://example.invalid/api/costs/ingest');
    let calls=0;
    const send=async()=>{calls++;return {ok:true,acknowledgement:{received:0,added:0,revised:0,duplicate:0,unassigned:0,quality:'complete'}};};
    const apply=async time=>{
      const result=await flushOutbox({directory,endpoint,token:'fixture-only',send});
      status.uploadState=result.failed?'failed':'success';
      saveAccountStatus(directory,status,{uploaded:result.uploaded,uploadFinishedAt:time});
      return result;
    };
    assert.deepEqual(await apply('2026-09-28T10:00:00.000Z'),{uploaded:0,skipped:0,failed:0});
    assert.equal(status.uploadState,'success');
    assert.equal(status.lastUploadSuccessAt,undefined);
    const payload={version:'mpdee-costs-v1',provider:'cursor',accountRef:'a'.repeat(32),quality:'complete',events:[]};
    writeFileSync(path.join(directory,`${payload.accountRef}-1-2.json`),JSON.stringify(payload));
    const uploadedAt='2026-09-28T11:00:00.000Z';
    assert.deepEqual(await apply(uploadedAt),{uploaded:1,skipped:0,failed:0});
    assert.equal(status.lastUploadSuccessAt,uploadedAt);
    assert.deepEqual(await apply('2026-09-28T12:00:00.000Z'),{uploaded:0,skipped:1,failed:0});
    assert.equal(status.lastUploadSuccessAt,uploadedAt);
    assert.equal(calls,1);
    assert.equal(status.finishedAt,'2026-09-27T10:00:00.000Z');
    const partialAt='2026-09-28T13:00:00.000Z';
    status.uploadState='failed';
    saveAccountStatus(directory,status,{uploaded:1,uploadFinishedAt:partialAt});
    assert.equal(status.lastUploadSuccessAt,partialAt);
    assert.equal(status.uploadState,'failed');
  } finally {rmSync(directory,{recursive:true,force:true});}
});
