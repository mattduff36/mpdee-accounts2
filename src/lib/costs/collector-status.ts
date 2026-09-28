import { z } from 'zod'
export const cursorAccounts=['admin@mpdee.co.uk','mattduff36@gmail.com','matt.mpdee@gmail.com','mattduff36@hotmail.com'] as const
export const collectorStatusSchema=z.object({
 version:z.literal(1),expected:z.literal(4),succeeded:z.number().int().min(0).max(4),finishedAt:z.string().datetime(),uploadState:z.enum(['success','failed','not_requested']),
 accounts:z.array(z.object({email:z.enum(cursorAccounts),startedAt:z.string().datetime(),finishedAt:z.string().datetime(),state:z.enum(['missing_session','identity_unverified','identity_mismatch','collection_failed','success']),accountRef:z.string().regex(/^[a-f0-9]{32}$/).optional()}).strict()).length(4),
}).strict().superRefine((v,c)=>{
 if(new Set(v.accounts.map(a=>a.email)).size!==4)c.addIssue({code:'custom',message:'Report four distinct accounts.'})
 if(v.accounts.filter(a=>a.state==='success').length!==v.succeeded)c.addIssue({code:'custom',message:'Totals do not match.'})
 const refs=v.accounts.flatMap(a=>a.accountRef?[a.accountRef]:[])
 if(new Set(refs).size!==refs.length)c.addIssue({code:'custom',message:'Source identities must be distinct.'})
 if(v.accounts.some(a=>a.state==='success'&&!a.accountRef))c.addIssue({code:'custom',message:'Successful accounts require identity.'})
})
export const collectorLabels={missing_session:'Needs sign-in',identity_unverified:'Identity check failed',identity_mismatch:'Account identity mismatch',collection_failed:'Collection incomplete',success:'Usage checked'} as const
