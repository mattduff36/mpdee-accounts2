import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadRecoveryState,saveRecoveryState,selectRecoveryWindows,recordCompletedDay} from './recovery-state.mjs';
const DAY=86400000,ref='a'.repeat(32),cp=Date.parse('2026-01-10'),now=Date.parse('2026-02-10T12:00:00Z');
const fresh=()=>({version:1,accountRef:ref,nextFrom:cp-2*DAY,completedDays:[]});
test('seven inconclusive oldest windows do not starve later historical data',()=>{
 let state=fresh();const first=selectRecoveryWindows({state,checkpoint:cp,now});
 assert.equal(first.windows.filter(w=>w.historical).length,7);assert.ok(first.windows.length<=10);
 state={...state,nextFrom:first.nextFrom};const second=selectRecoveryWindows({state,checkpoint:cp,now});
 assert.equal(second.windows[0].from,cp+5*DAY);
 const proof=recordCompletedDay({...state,nextFrom:second.nextFrom},{from:cp+5*DAY,to:cp+6*DAY,now,checkpoint:cp});
 assert.equal(proof.checkpoint,cp);assert.deepEqual(proof.state.completedDays,[cp+5*DAY]);
});
test('proof across gaps never advances checkpoint until each missing day is completed',()=>{
 let state=fresh(),checkpoint=cp;
 ({state,checkpoint}=recordCompletedDay(state,{from:cp+DAY,to:cp+2*DAY,now,checkpoint}));assert.equal(checkpoint,cp);
 ({state,checkpoint}=recordCompletedDay(state,{from:cp,to:cp+DAY,now,checkpoint}));assert.equal(checkpoint,cp+2*DAY);assert.deepEqual(state.completedDays,[]);
});
test('partial current UTC day cannot create complete-day proof',()=>{
 const today=Math.floor(now/DAY)*DAY;
 const result=recordCompletedDay(fresh(),{from:today,to:now,now,checkpoint:cp});
 assert.deepEqual(result.state.completedDays,[]);assert.equal(result.checkpoint,cp);
});
test('cyclic rotation eventually revisits failures and keeps overlap plus recent usage',()=>{
 let state=fresh();let wrapped=false;
 for(let i=0;i<10;i++){const plan=selectRecoveryWindows({state,checkpoint:cp,now});assert.ok(plan.windows.length<=10);assert.ok(plan.windows.some(w=>w.to===now));if(i>0&&plan.windows[0].from===cp-2*DAY)wrapped=true;state={...state,nextFrom:plan.nextFrom};}
 assert.equal(wrapped,true);
});
test('save/load survives restart, isolates accounts, and fails closed for corrupt or mismatched state',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'cost-recovery-'));
 try {let state=loadRecoveryState(directory,ref,cp);state={...state,nextFrom:cp+7*DAY,completedDays:[cp+3*DAY]};saveRecoveryState(directory,state);assert.deepEqual(loadRecoveryState(directory,ref,cp),state);
 assert.deepEqual(loadRecoveryState(directory,'b'.repeat(32),cp),{version:1,accountRef:'b'.repeat(32),nextFrom:cp-2*DAY,completedDays:[]});
 writeFileSync(path.join(directory,`${ref}.recovery.json`),'{broken');assert.throws(()=>loadRecoveryState(directory,ref,cp));
 writeFileSync(path.join(directory,`${ref}.recovery.json`),JSON.stringify({...state,accountRef:'b'.repeat(32)}));assert.throws(()=>loadRecoveryState(directory,ref,cp));
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('completed historical days are skipped without erasing unknown gaps',()=>{
 const state={...fresh(),nextFrom:cp,completedDays:[cp+DAY,cp+2*DAY]};const plan=selectRecoveryWindows({state,checkpoint:cp,now});
 assert.equal(plan.windows[0].from,cp);assert.ok(!plan.windows.some(w=>w.from===cp+DAY));assert.ok(plan.windows.some(w=>w.from===cp+3*DAY));
});
test('invalid UTC boundaries, duplicate proof and future proof fail closed',()=>{
 assert.throws(()=>selectRecoveryWindows({state:{...fresh(),nextFrom:cp+1},checkpoint:cp,now}));
 assert.throws(()=>selectRecoveryWindows({state:{...fresh(),completedDays:[cp,cp]},checkpoint:cp,now}));
 assert.throws(()=>selectRecoveryWindows({state:{...fresh(),completedDays:[Math.floor(now/DAY)*DAY]},checkpoint:cp,now}));
});
