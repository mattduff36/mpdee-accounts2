import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
const DAY = 86400000;
const MAX_PROOF_DAYS = 100000;
const day = value => Number.isSafeInteger(value) && value >= 0 && value % DAY === 0;
function validate(state, accountRef = state?.accountRef) {
  if (!state || Object.keys(state).some(key => !['version','accountRef','nextFrom','completedDays'].includes(key)) ||
      state.version !== 1 || !/^[a-f0-9]{32}$/.test(accountRef ?? '') || state.accountRef !== accountRef ||
      !day(state.nextFrom) || !Array.isArray(state.completedDays) || state.completedDays.length > MAX_PROOF_DAYS ||
      state.completedDays.some(value => !day(value)) || new Set(state.completedDays).size !== state.completedDays.length) {
    throw new Error('Local recovery state is invalid; preserve it for review.');
  }
  return state;
}
function requireCheckpoint(checkpoint) {
  if (!day(checkpoint)) throw new Error('Recovery requires a valid UTC checkpoint.');
}
const fileFor = (directory, accountRef) => path.join(directory, `${accountRef}.recovery.json`);
export function loadRecoveryState(directory, accountRef, checkpoint) {
  requireCheckpoint(checkpoint);
  validate({version:1,accountRef,nextFrom:checkpoint,completedDays:[]},accountRef);
  try {return validate(JSON.parse(readFileSync(fileFor(directory,accountRef),'utf8')),accountRef);}
  catch(error) {
    if(error?.code==='ENOENT')return {version:1,accountRef,nextFrom:Math.max(0,checkpoint-2*DAY),completedDays:[]};
    throw new Error('Local recovery state could not be read; preserve it for review.');
  }
}
export function saveRecoveryState(directory,state) {
  validate(state);
  const file=fileFor(directory,state.accountRef),temporary=`${file}.${process.pid}.tmp`;
  writeFileSync(temporary,JSON.stringify(state),{mode:0o600});
  renameSync(temporary,file);
}
export function selectRecoveryWindows({state,checkpoint,now=Date.now(),initialDays=2}) {
  validate(state);requireCheckpoint(checkpoint);
  if(!Number.isSafeInteger(now)||now<=0||!Number.isInteger(initialDays)||initialDays<1||initialDays>45)throw new Error('Recovery selection arguments are invalid.');
  const today=Math.floor(now/DAY)*DAY;
  if(checkpoint>today || state.nextFrom>today || state.completedDays.some(from=>from>=today))throw new Error('Recovery state is ahead of the current UTC day.');
  const start=Math.max(0,checkpoint-2*DAY),recentStart=Math.max(start,today-2*DAY);
  let cursor=Math.max(start,state.nextFrom);
  if(cursor>=recentStart)cursor=start;
  const completed=new Set(state.completedDays);
  const windows=[];
  // The finite scan advances through completed days without spending requests.
  // Gaps remain implicit until a later rotation revisits them; they never advance coverage.
  while(cursor<recentStart && windows.length<7) {
    const from=cursor;cursor+=DAY;
    if(from>=checkpoint && completed.has(from))continue;
    windows.push({from,to:from+DAY,historical:true});
  }
  const nextFrom=cursor>=recentStart?start:cursor;
  for(let from=recentStart;from<now;from+=DAY)windows.push({from,to:Math.min(from+DAY,now),historical:false});
  const merged=new Map();
  for(const window of windows){const old=merged.get(window.from);merged.set(window.from,{...window,historical:window.historical||old?.historical||false});}
  return {windows:[...merged.values()].sort((a,b)=>a.from-b.from),nextFrom};
}
export function recordCompletedDay(state,{from,to,now=Date.now(),checkpoint}) {
  validate(state);requireCheckpoint(checkpoint);
  if(!Number.isSafeInteger(now)||!day(from)||!Number.isSafeInteger(to)||to<=from||to>now)throw new Error('Invalid completed recovery window.');
  const today=Math.floor(now/DAY)*DAY;
  if(checkpoint>today || state.completedDays.some(value=>value>=today))throw new Error('Completed recovery proof is ahead of the current UTC day.');
  const completed=new Set(state.completedDays.filter(value=>value>=checkpoint));
  // Do not trust a full-day-looking filename: the actual fetched window must be closed.
  if(to===from+DAY && to<=today && from>=checkpoint)completed.add(from);
  while(completed.has(checkpoint)){completed.delete(checkpoint);checkpoint+=DAY;}
  const nextState={...state,completedDays:[...completed].sort((a,b)=>a-b)};
  validate(nextState);
  return {state:nextState,checkpoint};
}
