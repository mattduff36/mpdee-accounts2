import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireWrite, requireAuth } from '@/lib/auth'
import { costTransaction, resolvePolicy } from '@/lib/costs/service'
import { unitsText } from '@/lib/costs/money'
import { reviewGroupKey, suggestProject } from '@/lib/costs/attribution'
import { PageHeader } from '@/components/PageHeader'
import { panel, inputClass, buttonClass } from '../ui'
import { AssignButton } from './AssignButton'
export const dynamic = 'force-dynamic'
export default async function ReviewPage({ searchParams }: { searchParams: { message?: string } }) {
  await requireWrite()
  const [events,projects,total,assigned,policies] = await Promise.all([
    prisma.costUsageEvent.findMany({ where: { projectId: null }, orderBy: [{ occurredAt: 'desc' },{id:'desc'}], take: 100, include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } } }),
    prisma.costProject.findMany({ where:{archived:false}, orderBy: { name: 'asc' } }),
    prisma.costUsageEvent.count({where:{projectId:null}}),
    prisma.costUsageEvent.findMany({where:{projectId:{not:null}},orderBy:[{occurredAt:'desc'},{id:'desc'}],take:501,include:{project:true,revisions:{orderBy:{revision:'desc'},take:1}}}),
    prisma.costPolicy.findMany(),
  ])
  const assignedHolds = new Map<string,{projectId:string;name:string;reason:string;policyMissing:boolean;count:number;latest:Date}>()
  for (const event of assigned.slice(0,500)) {
    const revision=event.revisions[0], project=event.project
    if (!project) continue
    const policy=resolvePolicy(policies,project.id,project.clientId,event.occurredAt)
    const reason=!revision?'Missing monetary revision':revision.quality!=='complete'?revision.reason??`Source coverage ${revision.quality}`:!policy?'No charging policy covering this usage date':null
    if (!reason) continue
    const key=`${project.id}:${reason}`, existing=assignedHolds.get(key)
    if (existing) existing.count++
    else assignedHolds.set(key,{projectId:project.id,name:project.name,reason,policyMissing:!!revision&&revision.quality==='complete'&&!policy,count:1,latest:event.occurredAt})
  }
  const names = new Map(projects.map(project=>[project.id,project.name]))
  const earliest = events.at(-1)?.occurredAt
  const latest = events[0]?.occurredAt
  const neighbours = earliest && latest ? await prisma.costUsageEvent.findMany({where:{ projectId:{not:null},occurredAt:{gte:new Date(earliest.getTime()-1800000),lte:new Date(latest.getTime()+1800000)}},select:{id:true,provider:true,accountRef:true,conversationId:true,workspaceRef:true,occurredAt:true,projectId:true},orderBy:{occurredAt:'desc'},take:10001}) : []
  const groups = new Map<string, typeof events>()
  for (const event of events) { const key=reviewGroupKey(event); groups.set(key,[...(groups.get(key)??[]),event]) }
  async function assign(form: FormData) {
    'use server'
    await requireWrite()
    const actor = await requireAuth()
    const ids=Array.from(new Set(form.getAll('eventId').map(String))), projectId=String(form.get('projectId')??''),reason=String(form.get('reason')??'').trim()
    if (!ids.length || ids.length>100 || !reason || reason.length>500 || !projectId) redirect('/costs/review?message=Choose+a+project+and+record+the+evidence+for+your+decision.')
    try {
      await costTransaction(async tx => {
        const project=await tx.costProject.findFirst({where:{id:projectId,archived:false}})
        if (!project) throw new Error('Unavailable project')
        const before=await tx.costUsageEvent.findMany({where:{id:{in:ids},projectId:null}})
        if (before.length!==ids.length) throw new Error('Review changed; refresh')
        await tx.costUsageEvent.updateMany({where:{id:{in:ids},projectId:null},data:{projectId,attribution:'manual',manualAssignment:true}})
        for (const event of before) await tx.auditLog.create({data:{userId:actor.id,action:'costs.event.assign',entityType:'CostUsageEvent',entityId:event.id,details:JSON.stringify({before:null,after:projectId,reason})}})
      })
    } catch { redirect('/costs/review?message=Assignment+could+not+be+saved.+Refresh+and+check+whether+these+events+were+already+assigned.') }
    revalidatePath('/costs'); revalidatePath('/costs/review'); redirect('/costs/review?message=Assignment+saved.+Future+imports+will+preserve+your+decision.')
  }
  return <div className="space-y-6">
    <PageHeader title="Review usage" description="Use the evidence to identify a project. Suggestions never assign or bill usage automatically." />
    {searchParams.message && <p role="status" className={panel}>{searchParams.message}</p>}
    <div className={`${panel} text-sm text-slate-600 space-y-2`}><p>Showing {events.length} of {total} unassigned events, grouped by conversation and UTC day. Assign a group only if every event belongs to the same project.</p><p>Evidence scores are rules-based hints, not statistical confidence. Same conversation: 95%; same workspace: 85%; activity within 30 minutes: 35%. Timing alone is not proof. A tied score has no recommended project.</p><p><Link className="text-blue-700 underline" href="/costs/projects">Manage project mappings and rates</Link> for recurring work. Assignment does not clear missing monetary data or charging policies.</p>{neighbours.length>10000 && <p className="text-amber-700">Nearby activity is limited to the latest 10,000 records; suggestions may be incomplete.</p>}</div>
    <section className={`${panel} space-y-3`} aria-labelledby="assigned-holds"><h2 id="assigned-holds" className="font-semibold">Assigned usage that still needs attention</h2><p className="text-sm text-slate-600">Checks the latest {Math.min(assigned.length,500)} assigned events across all dates for monetary and policy holds. A project assignment alone does not make usage billable.{assigned.length>500?' Older assigned events are outside this review; use the ledger month filter to inspect them.':''} Exchange-rate availability is shown separately in the ledger.</p>{assignedHolds.size?<ul className="divide-y divide-slate-100">{Array.from(assignedHolds,([key,hold])=><li key={key} className="flex flex-col gap-2 py-3 sm:flex-row sm:justify-between"><div><h3 className="text-sm font-medium">{hold.name} · {hold.count} {hold.count===1?'event':'events'}</h3><p className="mt-1 text-sm text-amber-800">{hold.reason}</p><p className="mt-1 text-xs text-slate-500">Most recent: {hold.latest.toISOString().replace('T',' ').slice(0,16)} UTC</p></div><div className="flex shrink-0 flex-wrap gap-3 text-sm"><Link className="text-blue-700 underline" href={hold.policyMissing?'/costs/projects':'/costs/import'}>{hold.policyMissing?'Review charging policy':'Review source import'}</Link><Link className="text-blue-700 underline" href={'/costs?'+new URLSearchParams({project:hold.projectId,month:hold.latest.toISOString().slice(0,7)})}>Inspect ledger</Link></div></li>)}</ul>:<p className="text-sm text-slate-600">No monetary or policy holds found in these assigned events.</p>}</section>
    <h2 className="text-lg font-semibold">Unassigned conversations</h2>
    {Array.from(groups).map(([key,group])=>{
      const event=group[0], revision=event.revisions[0], result=suggestProject(event,neighbours.slice(0,10000))
      const evidence=revision?.evidence as {taskContext?:{topics?:string[]}} | undefined
      const topics=Array.isArray(evidence?.taskContext?.topics)?evidence.taskContext.topics.filter(t=>typeof t==='string'):[]
      return <section key={key} className={`${panel} space-y-4`}>
        <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">{event.provider} · {group.length} {group.length===1?'event':'events'}</h2><span className="text-sm text-slate-500">{event.occurredAt.toISOString().slice(0,10)} · {group.at(-1)!.occurredAt.toISOString().slice(11,16)}–{event.occurredAt.toISOString().slice(11,16)} UTC</span></div>
        <p className="text-sm text-slate-600">{topics.length?topics.join(' · '):'Task context unavailable. A new local collection may add a private, category-only summary.'}</p>
        <div className="rounded-lg bg-blue-50 p-3 text-sm"><p className="font-medium">{result.suggestion ? `Suggested: ${names.get(result.suggestion.projectId)??'Archived project'} · ${result.suggestion.score}% evidence score`:'No clear project suggestion'}</p><p className="mt-1 text-slate-600">{result.suggestion?.evidence??'No unique supporting evidence. Leave this group unassigned until you can identify it.'}</p>{result.candidates.length>0 && <p className="mt-2 text-xs text-slate-500">Related assigned activity: {result.candidates.slice(0,5).map(item=>`${names.get(item.projectId)??'Archived project'} (${item.score}%)`).join(' · ')}</p>}</div>
        <details className="text-sm"><summary className="cursor-pointer font-medium">Inspect events and source references</summary><dl className="mt-3 break-all text-xs text-slate-500"><dt>Workspace</dt><dd>{event.workspaceRef??'Unavailable'}</dd><dt>Conversation mapping reference</dt><dd>{event.conversationId?`${event.accountRef}/${event.conversationId}`:'Unavailable'}</dd><dt>Resource</dt><dd>{event.resourceRef??'Unavailable'}</dd></dl><ul className="mt-3 divide-y divide-slate-100">{group.map(e=><li key={e.id} className="py-2 text-xs text-slate-600">{e.occurredAt.toISOString().slice(11,19)} UTC · {e.model??'Infrastructure'} · {e.revisions[0]?.funding??'Unknown funding'} · nominal {e.revisions[0]?.nominalUnits==null?'unavailable':`${e.revisions[0].currency} ${unitsText(e.revisions[0].nominalUnits)}`} {e.revisions[0]?.reason&&` · ${e.revisions[0].reason}`}</li>)}</ul></details>
        <form action={assign} className="grid gap-3 md:grid-cols-3">{group.map(e=><input key={e.id} type="hidden" name="eventId" value={e.id}/>)}<label className="text-sm">Assign project<select name="projectId" className={inputClass} required defaultValue=""><option value="">Choose after checking evidence</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="text-sm">Evidence for this decision<input name="reason" placeholder="For example, confirmed workspace or task" className={inputClass} required maxLength={500}/></label><AssignButton count={group.length}/></form>
      </section>
    })}
    {!events.length&&<p className={panel}>All imported usage has a project. Charging policies and monetary holds are shown on the ledger.</p>}
  </div>
}
