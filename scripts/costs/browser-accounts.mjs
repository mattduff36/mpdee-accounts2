import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { EXPECTED_ACCOUNTS, accountDirectory, normalizeEmail, identityMatches, loadAccountCredential, saveAccountCredential } from './accounts.mjs';
import { DASHBOARD_ORIGIN, EVENTS_ENDPOINT } from './cursor-adapter.mjs';
import { retryTransient } from './reliability.mjs';

export function browserProfileDirectory(email) {
  if (!EXPECTED_ACCOUNTS.includes(email)) throw new Error('Unrecognized Cursor account.');
  return path.join(accountDirectory(), 'browser-profiles', createHash('sha256').update(email).digest('hex').slice(0,16));
}
async function openProfile(email, headless) {
  let chromium;
  try {
    ({chromium} = await import('playwright-core'));
    const candidates = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean).map(root=>path.join(root,'Google','Chrome','Application','chrome.exe'));
    const executablePath = candidates.find(existsSync);
    if (!executablePath) throw new Error();
    const profile = browserProfileDirectory(email);
    mkdirSync(profile,{recursive:true,mode:0o700});
    return await chromium.launchPersistentContext(profile,{executablePath,headless,chromiumSandbox:true,viewport:{width:1200,height:850},timeout:30000});
  } catch { throw new Error('Dedicated Cursor Chrome profile could not be opened; check local setup and close any account sign-in window.'); }
}
async function readIdentity(context) {
  try {
    const response=await context.request.get(`${DASHBOARD_ORIGIN}/api/auth/me`,{maxRedirects:0,timeout:20000});
    if (!response.ok() || response.status()===204) throw new Error();
    const value=await response.json();
    if (typeof value.email!=='string' || value.email_verified!==true || typeof value.sub!=='string' || !value.sub) throw new Error();
    return {email:normalizeEmail(value.email),identityKey:createHash('sha256').update(`cursor-identity:${value.sub}`).digest('hex')};
  } catch { throw new Error('Cursor browser account identity could not be verified.'); }
}
export function browserBinding(email,identity,stored) {
  if (identity.email!==email || !/^[a-f0-9]{64}$/.test(identity.identityKey??'')) throw new Error('Sign in to the requested Cursor account in its dedicated window.');
  if (stored && !identityMatches(email,stored,identity)) throw new Error('Browser account conflicts with its saved identity; preserve it for review.');
  return {email,transport:'chrome',profileDir:browserProfileDirectory(email),identityKey:identity.identityKey,
    providerAccountRef:stored?.providerAccountRef ?? createHash('sha256').update(`cursor-browser:${identity.identityKey}`).digest('hex').slice(0,32)};
}
export async function registerBrowserAccount(email) {
  email=normalizeEmail(email);
  if (!EXPECTED_ACCOUNTS.includes(email)) throw new Error('Choose one of the four expected Cursor account emails.');
  const stored=loadAccountCredential(email);
  const context=await openProfile(email,false);
  try {
    const page=context.pages()[0] ?? await context.newPage();
    await page.goto(`${DASHBOARD_ORIGIN}/dashboard`,{waitUntil:'domcontentloaded'});
    console.log(`Sign in manually to ${email} in the dedicated Chrome window. Leave other account windows signed in.`);
    const deadline=Date.now()+10*60*1000;
    while (Date.now()<deadline) {
      let identity;
      try { identity=await readIdentity(context); } catch {}
      if (identity) {
        const bound=browserBinding(email,identity,stored);
        saveAccountCredential(bound);
        console.log(`Registered dedicated Chrome session for ${email}. No credentials exported.`);
        return;
      }
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    throw new Error('Account registration timed out; rerun to resume the same dedicated profile.');
  } finally { await context.close().catch(()=>{}); }
}
export function createBrowserTransport() {
  const contexts=new Map();
  return {
    async verify(credential) {
      if (credential.profileDir!==browserProfileDirectory(credential.email)) throw new Error('Unexpected local browser profile.');
      const context=await openProfile(credential.email,true);
      contexts.set(credential.email,context);
      return readIdentity(context);
    },
    async post(credential,request) {
      const context=contexts.get(credential.email);
      if (!context) throw new Error('Cursor browser session is not verified.');
      return retryTransient(async()=>{
        let response;
        try { response=await context.request.post(EVENTS_ENDPOINT,{data:request,maxRedirects:0,timeout:20000,headers:{Origin:DASHBOARD_ORIGIN,Referer:`${DASHBOARD_ORIGIN}/dashboard`}}); }
        catch { const error=new Error('Cursor browser usage request failed.');error.transient=true;throw error; }
        if (!response.ok()) {const error=new Error('Cursor browser usage request was not authorized or available.');error.transient=response.status()===429||response.status()>=500;throw error;}
        try {return await response.json();} catch {throw new Error('Cursor browser usage response was invalid.');}
      });
    },
    async close(email) {const context=contexts.get(email);contexts.delete(email);if(context)await context.close().catch(()=>{});},
  };
}
