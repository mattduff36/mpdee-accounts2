'use server'
import { revalidatePath } from 'next/cache'
import { requireWrite, requireAuth } from '@/lib/auth'
import { costTransaction } from '@/lib/costs/service'
import { matrixSchema, mappedProject, policyData, rangeInput, rangesOverlap, parseUtcDate, coversDate } from '@/lib/costs/project-matrix'
import { coveringDailyRate, membershipDates, planMembershipRewrite, type DailyRate } from '@/lib/costs/membership-lines'
import { Prisma } from '@prisma/client'
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
export async function savePolicyRange(raw: unknown): Promise<SaveResult> {
  await requireWrite()
  const actor = await requireAuth()
  const parsed = rangeInput.safeParse(raw)
  if (!parsed.success || Boolean(parsed.data.projectId) === Boolean(parsed.data.clientId)) return { ok: false, message: 'Choose a project or client, then try again.' }
  try {
    const result = await costTransaction(async tx => {
      const { id, projectId, clientId } = parsed.data
      const scopeKey = projectId ? `project:${projectId}` : `client:${clientId}`
      const peers = await tx.costPolicy.findMany({ where: projectId ? { projectId } : { clientId: clientId! } })
      if (id && !peers.some(policy => policy.id === id)) throw new Error('Choose a rate that still exists, then try again.')
      const data = policyData(parsed.data)
      if (peers.some(policy => policy.id !== id && policy.effectiveAt.getTime() === data.effectiveAt.getTime())) throw new Error('Choose a start date that is not already used by another rate.')
      const proposed = peers.filter(policy => policy.id !== id).map(policy => ({ effectiveAt: policy.effectiveAt, effectiveUntil: policy.effectiveUntil })).concat(data)
      if (rangesOverlap(proposed)) throw new Error('Choose dates that do not overlap an existing rate.')
      const saved = id
        ? await tx.costPolicy.update({ where: { id }, data: { ...data, scopeKey, projectId, clientId: projectId ? null : clientId } })
        : await tx.costPolicy.create({ data: { ...data, scopeKey, projectId, clientId: projectId ? null : clientId } })
      const today = new Date().toISOString().slice(0, 10)
      const savedPeers = peers.filter(policy => policy.id !== saved.id).concat(saved)
      const dates = membershipDates(saved, savedPeers, today)
      const targets = projectId ? [{ id: projectId, dates }] : await clientMembershipTargets(tx, clientId!, dates)
      let updated = 0, added = 0
      for (const target of targets) {
        const written = await writeMembershipDays(tx, target.id, target.dates, saved.vercelDailyPence, saved.id)
        updated += written.updated
        added += written.added
      }
      await tx.auditLog.create({ data: { userId: actor.id, action: id ? 'costs.policy.update' : 'costs.policy.create', entityType: 'CostPolicy', entityId: saved.id, details: JSON.stringify({ scopeKey, from: data.effectiveAt.toISOString().slice(0, 10), until: data.effectiveUntil?.toISOString().slice(0, 10) ?? null, vercelDailyPence: data.vercelDailyPence, updated, added }) } })
      return { from: data.effectiveAt.toISOString().slice(0, 10), updated, added }
    })
    revalidatePath('/costs', 'layout')
    return { ok: true, message: `Saved the rate from ${result.from}. Updated ${result.updated} Vercel membership days and added ${result.added}. Estimates use the saved dates; issued invoices are unchanged.` }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const safe = ['Choose', 'Included base', 'Percentage'].some(prefix => message.startsWith(prefix))
    return { ok: false, message: safe ? message : 'Nothing was saved. Check the dates and amounts, or reload and try again.' }
  }
}
export async function deletePolicyRange(raw: unknown): Promise<SaveResult> {
  await requireWrite()
  const actor = await requireAuth()
  const input = raw && typeof raw === 'object' ? raw as { id?: unknown; projectId?: unknown; clientId?: unknown } : {}
  const id = typeof input.id === 'string' ? input.id : ''
  const projectId = typeof input.projectId === 'string' ? input.projectId : null
  const clientId = typeof input.clientId === 'string' ? input.clientId : null
  if (!id || Boolean(projectId) === Boolean(clientId)) return { ok: false, message: 'Choose a project or client, then try again.' }
  try {
    const result = await costTransaction(async tx => {
      const peers = await tx.costPolicy.findMany({ where: projectId ? { projectId } : { clientId: clientId! } })
      const target = peers.find(policy => policy.id === id)
      if (!target) throw new Error('Choose a rate that still exists, then try again.')
      const today = new Date().toISOString().slice(0, 10)
      const dates = membershipDates(target, peers, today)
      await tx.costPolicy.delete({ where: { id } })
      const remaining = peers.filter(policy => policy.id !== id)
      let updated = 0
      if (projectId) {
        const project = await tx.costProject.findUnique({ where: { id: projectId }, select: { clientId: true } })
        const clientPolicies = project?.clientId ? await tx.costPolicy.findMany({ where: { clientId: project.clientId, projectId: null } }) : []
        updated = (await writeReplacementDays(tx, projectId, dates, remaining, clientPolicies)).updated
      } else {
        const projects = await tx.costProject.findMany({ where: { clientId: clientId!, archived: false }, select: { id: true } })
        const projectPolicies = projects.length ? await tx.costPolicy.findMany({ where: { projectId: { in: projects.map(project => project.id) } } }) : []
        for (const project of projects) {
          const own = projectPolicies.filter(policy => policy.projectId === project.id)
          const openDates = dates.filter(day => !own.some(policy => coversDate(policy, own, parseUtcDate(day))))
          updated += (await writeReplacementDays(tx, project.id, openDates, [], remaining)).updated
        }
      }
      await tx.auditLog.create({ data: { userId: actor.id, action: 'costs.policy.delete', entityType: 'CostPolicy', entityId: id, details: JSON.stringify({ scopeKey: projectId ? `project:${projectId}` : `client:${clientId}`, from: target.effectiveAt.toISOString().slice(0, 10), until: target.effectiveUntil?.toISOString().slice(0, 10) ?? null, vercelDailyPence: target.vercelDailyPence, updated }) } })
      return { from: target.effectiveAt.toISOString().slice(0, 10), updated }
    })
    revalidatePath('/costs', 'layout')
    return { ok: true, message: `Deleted the rate from ${result.from}. Updated ${result.updated} Vercel membership days to the rate that remains, or to £0.00 where no rate covers the day. Estimates use the remaining dates; issued invoices are unchanged.` }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return { ok: false, message: message.startsWith('Choose') ? message : 'Nothing was deleted. Reload the rates and try again.' }
  }
}
function membershipEvidence(existing: Prisma.JsonValue | undefined, policyId: string | null, dailyPence: number): Prisma.InputJsonObject {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
  return { ...base, rateRevision: { policyId, dailyPence } }
}
async function writeMembershipDays(tx: Prisma.TransactionClient, projectId: string, dates: string[], pence: number, policyId: string | null) {
  if (!dates.length) return { updated: 0, added: 0 }
  const rows = await tx.costLegacyCharge.findMany({ where: { projectId, sourceBucket: { startsWith: 'vercel:membership:' } }, select: { id: true, sourceBucket: true, periodStart: true, periodEnd: true, frozenGbpPence: true, sourceRevision: true, sourceEvidence: true } })
  const plan = planMembershipRewrite(rows, dates, pence)
  let updated = 0, added = 0
  for (const change of plan.updates) {
    const existing = rows.find(row => row.id === change.id)
    await tx.costLegacyCharge.update({ where: { id: change.id }, data: { frozenGbpPence: change.frozenGbpPence, sourceRevision: change.sourceRevision, sourceChecksum: change.sourceChecksum, sourceEvidence: membershipEvidence(existing?.sourceEvidence, policyId, pence) } })
    updated++
  }
  for (const change of plan.inserts) {
    const day = change.sourceBucket.slice(-10)
    await tx.costLegacyCharge.create({ data: { id: `membership_${projectId}_${day}`, projectId, sourceSystem: 'mpdee-accounts', sourceDatabaseFingerprint: `project-rate:${projectId}`, sourceKind: 'MANUAL', sourceBucket: change.sourceBucket, sourceRevision: 1, sourceChecksum: change.sourceChecksum, category: 'VERCEL_HOSTING', periodStart: change.periodStart, periodEnd: change.periodEnd, label: 'Vercel Pro membership share', frozenGbpPence: change.frozenGbpPence, invoiceability: 'INVOICEABLE', sourceEvidence: { origin: 'project-rate', policyId, dailyPence: pence } satisfies Prisma.InputJsonObject } })
    added++
  }
  return { updated, added }
}
async function writeReplacementDays(tx: Prisma.TransactionClient, projectId: string, dates: string[], projectPolicies: (DailyRate & { id: string })[], clientPolicies: (DailyRate & { id: string })[]) {
  const groups = new Map<string, { policyId: string | null; pence: number; dates: string[] }>()
  for (const date of dates) {
    const rate = coveringDailyRate(projectPolicies, parseUtcDate(date)) ?? coveringDailyRate(clientPolicies, parseUtcDate(date))
    const key = rate ? rate.id : 'none'
    const group = groups.get(key) ?? { policyId: rate?.id ?? null, pence: rate?.vercelDailyPence ?? 0, dates: [] }
    group.dates.push(date)
    groups.set(key, group)
  }
  let updated = 0, added = 0
  for (const group of Array.from(groups.values())) {
    const written = await writeMembershipDays(tx, projectId, group.dates, group.pence, group.policyId)
    updated += written.updated
    added += written.added
  }
  return { updated, added }
}
async function clientMembershipTargets(tx: Prisma.TransactionClient, clientId: string, dates: string[]) {
  const projects = await tx.costProject.findMany({ where: { clientId, archived: false }, select: { id: true } })
  const policies = projects.length ? await tx.costPolicy.findMany({ where: { projectId: { in: projects.map(project => project.id) } } }) : []
  return projects.map(project => {
    const peers = policies.filter(policy => policy.projectId === project.id)
    return { id: project.id, dates: dates.filter(day => !peers.some(policy => coversDate(policy, peers, parseUtcDate(day)))) }
  })
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
            await tx.costPolicy.create({data:{scopeKey,projectId:p.id,effectiveAt,billable:seed.slug==='itrader',markupBps:seed.slug==='itrader'?1000:0,vercelDailyPence:seed.slug==='itrader'?38:0}});policies++
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
