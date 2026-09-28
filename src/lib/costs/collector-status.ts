import { z } from 'zod'
export const cursorAccounts=['admin@mpdee.co.uk','mattduff36@gmail.com','matt.mpdee@gmail.com','mattduff36@hotmail.com'] as const
export const collectorStatusSchema=z.object({
 mode:z.literal('active_account').optional(),activeAccount:z.enum(cursorAccounts).optional(),
 version:z.literal(1),expected:z.literal(4),succeeded:z.number().int().min(0).max(4),finishedAt:z.string().datetime(),uploadState:z.enum(['success','failed','not_requested']),lastUploadSuccessAt:z.string().datetime().optional(),
 accounts:z.array(z.object({email:z.enum(cursorAccounts),startedAt:z.string().datetime(),finishedAt:z.string().datetime(),state:z.enum(['inactive','missing_session','identity_unverified','identity_mismatch','collection_failed','success']),accountRef:z.string().regex(/^[a-f0-9]{32}$/).optional(),lastSuccessAt:z.string().datetime().optional(),coveredThrough:z.string().datetime().optional(),catchingUp:z.boolean().optional()}).strict()).length(4),
}).strict().superRefine((v,c)=>{
 if(new Set(v.accounts.map(a=>a.email)).size!==4)c.addIssue({code:'custom',message:'Report four distinct accounts.'})
 if(v.accounts.filter(a=>a.state==='success').length!==v.succeeded)c.addIssue({code:'custom',message:'Totals do not match.'})
 const refs=v.accounts.flatMap(a=>a.accountRef?[a.accountRef]:[])
 if(new Set(refs).size!==refs.length)c.addIssue({code:'custom',message:'Source identities must be distinct.'})
 if(v.accounts.some(a=>a.state==='success'&&!a.accountRef))c.addIssue({code:'custom',message:'Successful accounts require identity.'})
 if(v.mode==='active_account'){
  if(v.succeeded>1)c.addIssue({code:'custom',message:'Only one active account can succeed.'})
  if(v.accounts.some(a=>a.email!==v.activeAccount&&a.state!=='inactive'))c.addIssue({code:'custom',message:'Other accounts must be inactive.'})
 }else if(v.activeAccount||v.accounts.some(a=>a.state==='inactive'))c.addIssue({code:'custom',message:'Inactive accounts require active-account mode.'})
})
export const collectorLabels={inactive:'Inactive until next used',missing_session:'Needs sign-in',identity_unverified:'Identity check failed',identity_mismatch:'Account identity mismatch',collection_failed:'Collection incomplete',success:'Usage checked'} as const

export function recoveredCompleteDay(exclusiveBoundary:string){
 const date=new Date(exclusiveBoundary)
 date.setUTCHours(0,0,0,0)
 date.setUTCDate(date.getUTCDate()-1)
 return date.toISOString().slice(0,10)
}

export function collectorRunHealth(report:ReturnType<typeof collectorStatusSchema.parse>|null,now=Date.now()){
 const stale=!report||now-Date.parse(report.finishedAt)>3*3600000
 const activeMode=report?.mode==='active_account'
 const active=activeMode?report.accounts.find(a=>a.email===report.activeAccount):undefined
 const catchingUp=activeMode?Boolean(active?.catchingUp):Boolean(report?.accounts.some(a=>a.catchingUp))
 const healthy=!stale&&report?.uploadState==='success'&&!catchingUp&&(activeMode?active?.state==='success':report?.succeeded===4)
 return {stale,activeMode,active,catchingUp,healthy}
}
