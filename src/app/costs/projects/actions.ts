'use server'
import { revalidatePath } from 'next/cache'
import { requireWrite, requireAuth } from '@/lib/auth'
import { costTransaction } from '@/lib/costs/service'
import { matrixSchema, mappedProject, policyData } from '@/lib/costs/project-matrix'
import { discoveredVercelProjects } from '@/lib/costs/project-inventory'
export type SaveResult = { ok: boolean; message: string }
export async function saveMatrix(raw: unknown): Promise<SaveResult> {
  await requireWrite()
  const actor = await requireAuth()
  const parsed = matrixSchema.safeParse(raw)
  if (!parsed.success) return {ok:false,message:'Check the project fields and source references, then try again.'}
  try {
    const result = await costTransaction(async tx => {
      let projectCount=0, rateCount=0, mappingCount=0, assigned=0, conflicts=0
      const activeClients = new Set((await tx.client.findMany({where:{isArchived:false},select:{id:true}})).map(c=>c.id))
      for (const row of parsed.data.projects) {
        const previous = await tx.costProject.findUniqueOrThrow({where:{id:row.id}})
        if (previous.clientId !== row.previousClientId || previous.repository !== row.previousRepository) throw new Error('A project was changed in another session. Reload before saving to avoid overwriting it.')
        if (row.clientId && row.clientId !== previous.clientId && !activeClients.has(row.clientId)) throw new Error('Choose an active client.')
        if (previous.clientId !== row.clientId || previous.repository !== row.repository) {
          await tx.costProject.update({where:{id:row.id},data:{clientId:row.clientId,repository:row.repository}})
          await tx.auditLog.create({data:{userId:actor.id,action:'costs.project.update',entityType:'CostProject',entityId:row.id,details:JSON.stringify({before:{clientId:previous.clientId,repository:previous.repository},after:{clientId:row.clientId,repository:row.repository}})}})
          projectCount++
        }
        if (row.policy) {
          const data=policyData(row.policy)
          await tx.costPolicy.create({data:{...data,scopeKey:`project:${row.id}`,projectId:row.id}})
          rateCount++
        }
        for (const mapping of row.mappings) {
          if (mapping.type === 'conversation' && !/^[^/]+\/.+$/.test(mapping.value)) throw new Error('Choose a conversation reference in accountRef/conversationId format.')
          const existing=await tx.costProjectMapping.findUnique({where:{type_value:mapping}})
          if (existing && existing.projectId !== row.id) throw new Error('A source reference is already linked to another project. No changes were saved; review the conflicting reference.')
          if (!existing) { await tx.costProjectMapping.create({data:{...mapping,projectId:row.id}}); mappingCount++ }
        }
      }
      for (const row of parsed.data.clients) {
        if (!activeClients.has(row.id)) throw new Error('Choose an active client.')
        await tx.costPolicy.create({data:{...policyData(row.policy),scopeKey:`client:${row.id}`,clientId:row.id}})
        rateCount++
      }
      if (mappingCount) {
        const mappings=await tx.costProjectMapping.findMany()
        const newRefs=parsed.data.projects.flatMap(p=>p.mappings)
        const events=await tx.costUsageEvent.findMany({where:{manualAssignment:false,OR:newRefs.map(m=>m.type==='workspace'?{workspaceRef:m.value}:m.type==='conversation'?{accountRef:m.value.slice(0,m.value.indexOf('/')),conversationId:m.value.slice(m.value.indexOf('/')+1)}:{provider:m.type.replace('-resource',''),resourceRef:m.value})}})
        for (const event of events) {
          const next=mappedProject(event,mappings)
          if (!next || (event.projectId===next.projectId && event.attribution===next.attribution)) continue
          await tx.costUsageEvent.update({where:{id:event.id},data:next})
          await tx.auditLog.create({data:{userId:actor.id,action:'costs.event.remap',entityType:'CostUsageEvent',entityId:event.id,details:JSON.stringify({before:event.projectId,...next,source:'project-matrix'})}})
          if(next.projectId) assigned++; else conflicts++
        }
      }
      const counts={projectCount,rateCount,mappingCount,assigned,conflicts}
      await tx.auditLog.create({data:{userId:actor.id,action:'costs.matrix.save',entityType:'CostProject',details:JSON.stringify({counts,changes:parsed.data})}})
      return counts
    })
    revalidatePath('/costs','layout')
    return {ok:true,message:`Saved ${result.projectCount} project changes, ${result.rateCount} new rates and ${result.mappingCount} source links. ${result.assigned} existing usage records assigned; ${result.conflicts} conflicts held for review. Open Overview to see recalculated estimates. Rates apply from their effective date; no re-import is needed. Previous rate history is retained.`}
  } catch (error) {
    const message=error instanceof Error ? error.message : ''
    const safe=['Choose','Included base','Percentage','A project','A source'].some(prefix=>message.startsWith(prefix))
    return {ok:false,message:safe?message:'Nothing was saved. Check for a rate already using the same effective date, or reload and try again.'}
  }
}
export async function setupProjects(kind: 'known'|'discovered'): Promise<SaveResult> {
  await requireWrite(); const actor=await requireAuth()
  try {
    const result=await costTransaction(async tx=>{
      let projects=0,mappings=0,policies=0,conflicts=0
      const seeds=kind==='known' ? [
        {slug:'itrader',name:'iTrader',repository:'mattduff36/iommarket',id:'prj_TFAfJkG9P0osjQpsH2gaNrSPWbCr',workspace:'d-Websites-iommarket'},
        {slug:'mpdee-accounts',name:'MPDEE Accounts',repository:'mattduff36/mpdee-accounts2',id:'prj_u78y1EPpA6EEVpMp6N14xlLFaCzY',workspace:'d-Websites-mpdee-accounts2'},
      ] : discoveredVercelProjects.map(p=>({...p,slug:p.name==='iommarket'?'itrader':p.name==='mpdee-accounts2'?'mpdee-accounts':`vercel-${p.name}`,repository:null,workspace:null}))
      for(const seed of seeds) {
        const mapped=await tx.costProjectMapping.findUnique({where:{type_value:{type:'vercel-resource',value:seed.id}}})
        if(kind==='discovered' && mapped) continue
        let p=await tx.costProject.findUnique({where:{slug:seed.slug}})
        if(!p) {p=await tx.costProject.create({data:{slug:seed.slug,name:seed.name,repository:seed.repository}});projects++}
        for(const [type,value] of [['vercel-resource',seed.id],...(seed.workspace?[['workspace',seed.workspace]]:[])]) {
          const existing=await tx.costProjectMapping.findUnique({where:{type_value:{type,value}}})
          if(!existing) {await tx.costProjectMapping.create({data:{type,value,projectId:p.id}});mappings++}
          else if(existing.projectId!==p.id) conflicts++
        }
        if(kind==='known') {
          const scopeKey=`project:${p.id}`,effectiveAt=new Date('2026-08-01T00:00:00Z')
          if(!await tx.costPolicy.findUnique({where:{scopeKey_effectiveAt:{scopeKey,effectiveAt}}})) {
            await tx.costPolicy.create({data:{scopeKey,projectId:p.id,effectiveAt,billable:seed.slug==='itrader',markupBps:seed.slug==='itrader'?1000:0}});policies++
          }
        }
      }
      const result={projects,mappings,policies,conflicts}
      await tx.auditLog.create({data:{userId:actor.id,action:'costs.projects.initialise',entityType:'CostProject',details:JSON.stringify({kind,...result})}})
      return result
    })
    revalidatePath('/costs','layout')
    return {ok:true,message:result.projects+result.mappings+result.policies ? `Added ${result.projects} projects, ${result.mappings} source links and ${result.policies} rates. ${result.conflicts} conflicting links left unchanged. Next, choose clients and check rates in the matrix.` : `Already set up: nothing needed adding. ${result.conflicts} conflicting links left unchanged. Choose clients and check rates in the matrix below.`}
  } catch {return {ok:false,message:'Setup could not complete. Nothing was changed; try again.'}}
}
export async function createProject(name:string,slug:string):Promise<SaveResult> {
  await requireWrite(); const actor=await requireAuth()
  if(!name.trim() || name.length>120 || !/^[a-z0-9-]{1,80}$/.test(slug)) return {ok:false,message:'Enter a name and a unique lowercase slug using letters, numbers and hyphens.'}
  try {
    await costTransaction(async tx=>{const p=await tx.costProject.create({data:{name:name.trim(),slug}});await tx.auditLog.create({data:{userId:actor.id,action:'costs.project.create',entityType:'CostProject',entityId:p.id,details:JSON.stringify({name,slug})}})})
    revalidatePath('/costs','layout');return {ok:true,message:'Project created. Link its client, rates and sources in the matrix.'}
  } catch {return {ok:false,message:'Project could not be created. Check that the slug is unique.'}}
}
