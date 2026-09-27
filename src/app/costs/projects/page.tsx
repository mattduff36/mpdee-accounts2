import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireWrite, requireAuth } from '@/lib/auth'
import { costTransaction } from '@/lib/costs/service'
import { discoveredVercelProjects } from '@/lib/costs/project-inventory'
import { percentBps } from '@/lib/costs/money'
import { PageHeader } from '@/components/PageHeader'
import { buttonClass, Field, inputClass, panel } from '../ui'
export const dynamic = 'force-dynamic'
const value = (form: FormData, name: string) => String(form.get(name) ?? '').trim()
const projectSchema = z.object({ name: z.string().min(1).max(120), slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/), clientId: z.string().max(100).nullable(), repository: z.string().max(250).nullable() })
export default async function ProjectsPage({ searchParams }: { searchParams: { message?: string } }) {
  await requireWrite()
  const [projects,clients,policies,mappings] = await Promise.all([
    prisma.costProject.findMany({ orderBy: { name: 'asc' }, include: { client: true } }),
    prisma.client.findMany({ where: { isArchived: false }, orderBy: { name: 'asc' } }),
    prisma.costPolicy.findMany({ orderBy: { effectiveAt: 'desc' }, include: { project: true, client: true } }),
    prisma.costProjectMapping.findMany({ include: { project: true }, orderBy: { type: 'asc' } }),
  ])
  async function addProject(form: FormData) {
    'use server'
    await requireWrite()
    const actor = await requireAuth()
    try {
      const data = projectSchema.parse({ name: value(form,'name'), slug: value(form,'slug'), clientId: value(form,'clientId') || null, repository: value(form,'repository') || null })
      await costTransaction(async tx => {
        const p = await tx.costProject.create({ data })
        await tx.auditLog.create({ data: { userId: actor.id, action: 'costs.project.create', entityType: 'CostProject', entityId: p.id, details: JSON.stringify(data) } })
      })
    } catch { redirect('/costs/projects?message=Project+could+not+be+saved.+Check+the+slug+is+unique+and+the+fields+are+valid.') }
    revalidatePath('/costs'); redirect('/costs/projects?message=Project+created')
  }
  async function saveClient(form: FormData) {
    'use server'
    await requireWrite()
    const actor = await requireAuth()
    try {
      await costTransaction(async tx => {
        const id = value(form,'projectId'), clientId = value(form,'clientId') || null
        const previous = await tx.costProject.findUniqueOrThrow({ where: { id } })
        await tx.costProject.update({ where: { id }, data: { clientId } })
        await tx.auditLog.create({ data: { userId: actor.id, action: 'costs.project.client', entityType: 'CostProject', entityId: id, details: JSON.stringify({ before: previous.clientId, after: clientId }) } })
      })
    } catch { redirect('/costs/projects?message=Client+link+could+not+be+saved') }
    revalidatePath('/costs'); redirect('/costs/projects?message=Client+linked.+Preview+estimates+now+use+the+linked+client+defaults.')
  }
  async function savePolicy(form: FormData) {
    'use server'
    await requireWrite()
    const actor = await requireAuth()
    try {
      const scope = value(form,'scope'), [kind,id] = scope.split(':')
      if (!['project','client'].includes(kind) || !id) throw new Error('Scope required')
      const rawDate = value(form,'effectiveAt')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) throw new Error('Date required')
      const date = new Date(`${rawDate}T00:00:00.000Z`)
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== rawDate) throw new Error('Invalid date')
      const includedBaseBps = percentBps(value(form,'includedBase'))
      if (includedBaseBps > 10000) throw new Error('Base cannot exceed 100%')
      const data = { scopeKey: scope, projectId: kind === 'project' ? id : null, clientId: kind === 'client' ? id : null,
        effectiveAt: date, billable: form.get('billable') === 'on', includedBaseBps,
        markupBps: percentBps(value(form,'markup')), infrastructureMarkupBps: percentBps(value(form,'infrastructureMarkup')) }
      await costTransaction(async tx => {
        const p = await tx.costPolicy.create({ data })
        await tx.auditLog.create({ data: { userId: actor.id, action: 'costs.policy.create', entityType: 'CostPolicy', entityId: p.id, details: JSON.stringify(data) } })
      })
    } catch { redirect('/costs/projects?message=Rate+could+not+be+saved.+Use+a+valid+date,+percentages+and+a+new+effective+date+for+this+scope.') }
    revalidatePath('/costs'); redirect('/costs/projects?message=Rate+saved.+Previous+policy+versions+are+retained.')
  }
  async function saveMapping(form: FormData) {
    'use server'
    await requireWrite()
    const actor = await requireAuth()
    try {
      const data = z.object({ type: z.enum(['workspace','conversation','vercel-resource','supabase-resource','manual-resource']), value: z.string().min(1).max(500), projectId: z.string().min(1).max(100) }).parse({ type: value(form,'type'), value: value(form,'value'), projectId: value(form,'projectId') })
      await costTransaction(async tx => {
        const m = await tx.costProjectMapping.create({ data })
        await tx.auditLog.create({ data: { userId: actor.id, action: 'costs.mapping.create', entityType: 'CostProjectMapping', entityId: m.id, details: JSON.stringify(data) } })
      })
    } catch { redirect('/costs/projects?message=Mapping+could+not+be+saved.+A+source+can+map+to+only+one+project.') }
    redirect('/costs/projects?message=Mapping+saved.+Re-import+the+usage+file+to+apply+it+to+existing+events.')
  }
  async function seedProjects() {
    'use server'
    await requireWrite()
    const actor = await requireAuth()
    await costTransaction(async tx => {
      const seeds = [
        ['itrader','iTrader','mattduff36/iommarket','prj_TFAfJkG9P0osjQpsH2gaNrSPWbCr','d-Websites-iommarket'],
        ['mpdee-accounts','MPDEE Accounts','mattduff36/mpdee-accounts2','prj_u78y1EPpA6EEVpMp6N14xlLFaCzY','d-Websites-mpdee-accounts2'],
      ]
      for (const [slug,name,repository,resource,workspace] of seeds) {
        const p = await tx.costProject.upsert({ where: { slug }, update: {}, create: { slug,name,repository } })
        for (const [type,val] of [['vercel-resource',resource],['workspace',workspace]]) {
          await tx.costProjectMapping.upsert({ where: { type_value: { type,value: val } }, update: {}, create: { type,value: val,projectId: p.id } })
        }
        await tx.costPolicy.upsert({ where: { scopeKey_effectiveAt: { scopeKey: `project:${p.id}`, effectiveAt: new Date('2026-08-01T00:00:00Z') } }, update: {}, create: { scopeKey: `project:${p.id}`,projectId: p.id,effectiveAt: new Date('2026-08-01T00:00:00Z'),billable: slug === 'itrader',markupBps: slug === 'itrader' ? 1000 : 0 } })
      }
      await tx.auditLog.create({ data: { userId: actor.id, action: 'costs.projects.initialise', entityType: 'CostProject', details: 'iTrader and Accounts only. No client links inferred.' } })
    })
    revalidatePath('/costs'); redirect('/costs/projects?message=iTrader+and+Accounts+are+ready.+Link+clients+below.')
  }
  async function addDiscoveredProjects() {
    'use server'
    await requireWrite()
    const actor = await requireAuth()
    await costTransaction(async tx => {
      for (const item of discoveredVercelProjects) {
        const mapped = await tx.costProjectMapping.findUnique({where:{type_value:{type:'vercel-resource',value:item.id}}})
        if (mapped) continue
        const known = item.name === 'iommarket' ? 'itrader' : item.name === 'mpdee-accounts2' ? 'mpdee-accounts' : `vercel-${item.name}`
        const p = await tx.costProject.upsert({where:{slug:known},update:{},create:{slug:known,name:item.name}})
        await tx.costProjectMapping.create({data:{type:'vercel-resource',value:item.id,projectId:p.id}})
      }
      await tx.auditLog.create({data:{userId:actor.id,action:'costs.projects.discover',entityType:'CostProject',details:'Imported 41 observed Vercel resources. Clients and rates require configuration.'}})
    })
    revalidatePath('/costs');redirect('/costs/projects?message=Discovered+Vercel+projects+added.+Set+client+links+and+rates+where+needed.')
  }
  return <div className="space-y-6"><PageHeader title="Projects & rates" description="Client defaults, project overrides and exact usage mappings."><Link href="/costs">Back to ledger</Link></PageHeader>
    {searchParams.message && <p role="status" className="rounded-xl bg-blue-50 p-4 text-sm text-blue-900">{searchParams.message}</p>}
    <div className={`${panel} space-y-3`}><h2 className="font-semibold">Start with known projects</h2><p className="text-sm text-slate-600">Add iTrader at 50% included base + 10 percentage points markup (60% included, 110% on-demand). Infrastructure is at face value. MPDEE Accounts starts as internal, non-billable. Initial policy date: 1 August 2026. Client links need your selection.</p><form action={seedProjects}><button className={buttonClass}>Add iTrader and Accounts</button></form></div>
    <div className={`${panel} space-y-3`}><h2 className="font-semibold">Other Vercel projects</h2><p className="text-sm text-slate-600">41 project resources were found in your Vercel account. Add them with their verified resource IDs. Client links, Cursor workspace mappings and rates are left for review.</p><form action={addDiscoveredProjects}><button className={buttonClass}>Add discovered Vercel projects</button></form></div>
    <div className={panel}><h2 className="mb-4 font-semibold">Projects and clients</h2><p className="mb-4 text-sm text-slate-500">Changing a client link recalculates preview estimates that use client defaults. Existing invoices are unaffected.</p><div className="space-y-4">{projects.map(p => <form action={saveClient} key={p.id} className="flex flex-wrap items-center gap-3 border-b pb-4"><input type="hidden" name="projectId" value={p.id}/><div className="min-w-48 flex-1"><p className="font-medium">{p.name}</p><p className="text-xs text-slate-500">{p.repository ?? p.slug}</p></div><label className="text-sm">Client<select name="clientId" aria-label={`Client for ${p.name}`} defaultValue={p.clientId ?? ''} className={inputClass}><option value="">No client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button className={buttonClass}>Save client</button></form>)}</div></div>
    <form action={addProject} className={`${panel} space-y-4`}><h2 className="font-semibold">Add a project</h2><div className="grid gap-4 md:grid-cols-2"><Field label="Project name"><input className={inputClass} name="name" required maxLength={120}/></Field><Field label="Stable slug"><input className={inputClass} name="slug" placeholder="my-project" pattern="[a-z0-9-]+" required maxLength={80}/></Field><Field label="Client"><select className={inputClass} name="clientId"><option value="">Unlinked / internal</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Repository (optional)"><input className={inputClass} name="repository" placeholder="owner/repository" maxLength={250}/></Field></div><button className={buttonClass}>Create project</button></form>
    <form action={savePolicy} className={`${panel} space-y-4`}><h2 className="font-semibold">Add an effective-dated rate</h2><p className="text-sm text-slate-600">The latest project policy on the usage date overrides the client default. Markup is added to nominal Cursor cost: a 50% base + 10% markup charges 60%. On-demand charges 100% + markup. Infrastructure has its own markup.</p><div className="grid gap-4 md:grid-cols-2"><Field label="Applies to"><select className={inputClass} name="scope" required><option value="">Choose project or client</option><optgroup label="Project overrides">{projects.map(p => <option key={p.id} value={`project:${p.id}`}>{p.name}</option>)}</optgroup><optgroup label="Client defaults">{clients.map(c => <option key={c.id} value={`client:${c.id}`}>{c.name}</option>)}</optgroup></select></Field><Field label="Effective from (UTC)"><input className={inputClass} name="effectiveAt" type="date" required defaultValue={new Date().toISOString().slice(0,10)}/></Field><Field label="Included base (%)"><input className={inputClass} name="includedBase" type="number" min="0" max="100" step="0.01" defaultValue="50" required/></Field><Field label="Cursor markup (%)"><input className={inputClass} name="markup" type="number" min="0" max="1000" step="0.01" defaultValue="10" required/></Field><Field label="Infrastructure markup (%)"><input className={inputClass} name="infrastructureMarkup" type="number" min="0" max="1000" step="0.01" defaultValue="0" required/></Field></div><label className="flex gap-2 text-sm"><input type="checkbox" name="billable"/>Chargeable to client (unchecked means internal / non-billable)</label><button className={buttonClass}>Save new rate</button></form>
    <div className={panel}><h2 className="mb-4 font-semibold">Rate history</h2><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Scope','Effective UTC','Included','On-demand','Infrastructure','Billable'].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{policies.map(p => <tr key={p.id} className="border-t"><td className="p-2">{p.project?.name ?? p.client?.name}</td><td className="p-2">{p.effectiveAt.toISOString().slice(0,10)}</td><td className="p-2">{(p.includedBaseBps+p.markupBps)/100}%</td><td className="p-2">{100+p.markupBps/100}%</td><td className="p-2">{100+p.infrastructureMarkupBps/100}%</td><td className="p-2">{p.billable ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div></div>
    <form action={saveMapping} className={`${panel} space-y-4`}><h2 className="font-semibold">Map usage to a project</h2><p className="text-sm text-slate-600">Use exact references from the collector. For a conversation, enter accountRef/conversationId. Conflicting mappings hold the event for review. Branches share one project and are never counted twice.</p><div className="grid gap-4 md:grid-cols-3"><Field label="Source type"><select name="type" className={inputClass}>{['workspace','conversation','vercel-resource','supabase-resource','manual-resource'].map(t => <option key={t}>{t}</option>)}</select></Field><Field label="Exact reference"><input name="value" className={inputClass} required maxLength={500}/></Field><Field label="Project"><select name="projectId" className={inputClass} required><option value="">Choose project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></div><button className={buttonClass}>Add mapping</button></form>
    <div className={panel}><h2 className="mb-3 font-semibold">Source mappings</h2><ul className="space-y-2 text-sm">{mappings.map(m => <li key={m.id} className="break-all"><span className="font-medium">{m.project.name}</span> · {m.type} · {m.value}</li>)}</ul></div>
  </div>
}
