import { z } from 'zod'
import { decimalUnits, percentBps } from './money'
export const mappingTypes = ['workspace','conversation','vercel-resource','supabase-resource','manual-resource'] as const
const policy = z.object({
  effectiveAt: z.string(),
  effectiveUntil: z.string().nullable().optional(),
  billable: z.boolean(),
  includedBase: z.string(),
  markup: z.string(),
  infrastructureMarkup: z.string(),
  vercelDaily: z.string().optional(),
})
export const rangeInput = policy.extend({ id: z.string().min(1).nullable(), projectId: z.string().min(1).nullable(), clientId: z.string().min(1).nullable() })
export const matrixSchema = z.object({
  projects: z.array(z.object({ id: z.string().min(1), clientId: z.string().nullable(), repository: z.string().trim().max(250).nullable(), previousClientId: z.string().nullable(), previousRepository: z.string().nullable(), policy: policy.nullable(), mappings: z.array(z.object({ type: z.enum(mappingTypes), value: z.string().trim().min(1).max(500) })).max(100) })).max(500),
  clients: z.array(z.object({ id: z.string().min(1), policy })).max(500),
})
export function parseUtcDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose a valid date.')
  const date = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Choose a valid date.')
  return date
}
export function penceFromPounds(text: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Choose a daily Vercel amount in pounds, such as 0.38.')
  const pence = Number(decimalUnits(text, 2))
  if (pence > 10_000_000) throw new Error('Choose a daily Vercel amount of £100,000 or less.')
  return pence
}
const dayMs = 86_400_000
export function dayBefore(value: Date) {
  return new Date(value.getTime() - dayMs)
}
export function nextUtcDate(value: string) {
  return new Date(parseUtcDate(value).getTime() + dayMs).toISOString().slice(0, 10)
}
export type RateRange = { effectiveAt: Date; effectiveUntil?: Date | null }
/** A blank end runs until the day before the next range. An explicit end past that next range is an overlap. */
export function coverageEnd(range: RateRange, peers: RateRange[]): Date | null {
  const next = peers.filter(peer => peer.effectiveAt > range.effectiveAt).sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime())[0]
  const implicit = next ? dayBefore(next.effectiveAt) : null
  if (!range.effectiveUntil) return implicit
  if (implicit && range.effectiveUntil > implicit) return implicit
  return range.effectiveUntil
}
export function coversDate(range: RateRange, peers: RateRange[], date: Date) {
  const day = date.toISOString().slice(0, 10)
  if (range.effectiveAt.toISOString().slice(0, 10) > day) return false
  const end = coverageEnd(range, peers)
  return !end || end.toISOString().slice(0, 10) >= day
}
export function rangesOverlap(ranges: RateRange[]) {
  const closed = ranges.map(range => {
    const next = ranges.filter(peer => peer.effectiveAt > range.effectiveAt).sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime())[0]
    const implicit = next ? dayBefore(next.effectiveAt) : null
    const explicitPastNext = !!(range.effectiveUntil && implicit && range.effectiveUntil > implicit)
    const end = range.effectiveUntil ?? implicit ?? new Date('9999-12-31T00:00:00.000Z')
    return { start: range.effectiveAt, end, explicitPastNext }
  })
  if (closed.some(range => range.explicitPastNext)) return true
  return closed.some((left, index) => closed.slice(index + 1).some(right => left.start <= right.end && right.start <= left.end))
}
export function policyData(input: z.infer<typeof policy>) {
  const effectiveAt = parseUtcDate(input.effectiveAt)
  const effectiveUntil = input.effectiveUntil ? parseUtcDate(input.effectiveUntil) : null
  if (effectiveUntil && effectiveUntil < effectiveAt) throw new Error('Choose an end date on or after the start date.')
  const includedBaseBps = percentBps(input.includedBase)
  if (includedBaseBps > 10000) throw new Error('Included base must not exceed 100%.')
  return { effectiveAt, effectiveUntil, billable: input.billable, includedBaseBps, markupBps: percentBps(input.markup), infrastructureMarkupBps: percentBps(input.infrastructureMarkup), vercelDailyPence: penceFromPounds(input.vercelDaily ?? '0') }
}
/** Exact evidence only. Existing conflicts and manual decisions are never silently cleared. */
export function mappedProject(event: { accountRef: string; conversationId: string|null; workspaceRef: string|null; resourceRef: string|null; provider: string; projectId: string|null; attribution: string; manualAssignment: boolean }, mappings: {type:string;value:string;projectId:string}[]) {
  if (event.manualAssignment || event.attribution === 'conflict') return null
  const keys = new Set([event.conversationId ? `conversation:${event.accountRef}/${event.conversationId}` : null, event.workspaceRef ? `workspace:${event.workspaceRef}` : null, event.resourceRef ? `${event.provider}-resource:${event.resourceRef}` : null].filter(Boolean))
  const candidates = Array.from(new Set(mappings.filter(m => keys.has(`${m.type}:${m.value}`)).map(m => m.projectId)))
  if (!candidates.length) return null
  if (candidates.length > 1 || (event.projectId && event.projectId !== candidates[0])) return {projectId:null, attribution:'conflict'}
  return {projectId:candidates[0], attribution:'mapped'}
}


export type ProjectIdentity = {id:string;name:string;slug:string;repository:string|null;mappings:{type:string;value:string}[]}
export type LocalIdentity = {name:string;repository:string;workspaceRef:string;vercelProjectId?:string}
/** Match exact Vercel IDs, or a unique folder + GitHub repository name pair. Never fuzzy-match. */
export function verifiedLocalConnections(projects:ProjectIdentity[], local:LocalIdentity[]) {
  const suggestions:{projectId:string;repository:string;workspaceRef:string;vercelProjectId?:string;reason:string}[]=[]
  for(const item of local) {
    const resourceMatches=item.vercelProjectId?projects.filter(p=>p.mappings.some(m=>m.type==='vercel-resource'&&m.value===item.vercelProjectId)):[]
    const repositoryName=item.repository.split('/').pop()
    const named=repositoryName===item.name?projects.filter(p=>p.name===item.name||p.slug.replace(/^vercel-/,'')===item.name||p.repository===item.repository):[]
    const matches=resourceMatches.length?resourceMatches:named
    if(matches.length!==1) continue
    const p=matches[0]
    if(p.repository&&p.repository!==item.repository) continue
    if(item.vercelProjectId&&projects.some(other=>other.id!==p.id&&other.mappings.some(m=>m.type==='vercel-resource'&&m.value===item.vercelProjectId))) continue
    if(projects.some(other=>other.id!==p.id&&other.mappings.some(m=>m.type==='workspace'&&m.value===item.workspaceRef))) continue
    // More than one local checkout claiming different repositories for this project is ambiguous.
    if(suggestions.some(s=>s.projectId===p.id&&s.repository!==item.repository)) continue
    suggestions.push({projectId:p.id,...item,reason:resourceMatches.length?'Exact Vercel resource ID':'Exact local folder and GitHub repository name'})
  }
  const ambiguous=new Set(suggestions.filter(s=>local.some(item=>item.vercelProjectId===s.vercelProjectId&&!!s.vercelProjectId&&item.repository!==s.repository)).map(s=>s.projectId))
  return suggestions.filter(s=>!ambiguous.has(s.projectId))
}
