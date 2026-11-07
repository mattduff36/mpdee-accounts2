import { z } from 'zod'
import { developmentPeriod } from './development-report'

const id = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/)
const name = z.string().trim().min(1).max(80).regex(/^[^\x00-\x1f\x7f]+$/)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v)
export const dashboardSettingsSchema = z.object({
  categories: z.array(z.object({ id, name }).strict()).max(100),
  assignments: z.record(id, id),
  bills: z.array(z.object({ id, sourceId: id, date: day, amountMinor: z.number().int().min(0).max(2_000_000_000), currency: z.enum(['GBP','USD','EUR']), reference: name }).strict()).max(5000),
}).strict().superRefine((v, ctx) => {
  if(new Set(v.categories.map(c=>c.id)).size !== v.categories.length || new Set(v.bills.map(b=>b.id)).size !== v.bills.length)
    ctx.addIssue({code:'custom',message:'Duplicate category or bill identity'})
  if(Object.values(v.assignments).some(x=>!v.categories.some(c=>c.id===x))) ctx.addIssue({code:'custom',message:'Choose an existing category'})
})
export type DashboardSettings = z.infer<typeof dashboardSettingsSchema>
export const emptySettings: DashboardSettings = { categories: [], assignments: {}, bills: [] }
export const presetSchema = z.enum(['this-month','last-month','this-quarter','this-year'])
export function dashboardPeriod(preset: z.infer<typeof presetSchema>, now = new Date()) {
  const today = developmentPeriod(now,'day'), year = Number(today.slice(0,4)), month = Number(today.slice(5,7))-1
  const iso = (y:number,m:number) => new Date(Date.UTC(y,m,1)).toISOString().slice(0,10)
  const from = preset==='last-month' ? iso(year,month-1) : preset==='this-year' ? iso(year,0) : preset==='this-quarter' ? iso(year,Math.floor(month/3)*3) : iso(year,month)
  const to = preset==='last-month' ? iso(year,month) : preset==='this-year' ? iso(year+1,0) : preset==='this-quarter' ? iso(year,Math.floor(month/3)*3+3) : iso(year,month+1)
  return {from,to,today}
}
export const days = (a:string,b:string) => (Date.parse(b)-Date.parse(a))/86400000
export function monthlyProjection(amount:number,start:string,end:string|null,from:string,to:string) {
  let result=0
  for(let cursor=from;cursor<to;) {
    const d=new Date(cursor), next=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)).toISOString().slice(0,10)
    const a=[cursor,start].sort().at(-1)!, b=[next,to,end??to].sort()[0]
    if(a<b) result+=amount*days(a,b)/days(cursor.slice(0,8)+'01',next)
    cursor=next
  }
  return Math.round(result)
}
export function expectedTotal(confirmed:number,estimate:number|null) { return estimate===null ? null : Math.max(confirmed,estimate) }
