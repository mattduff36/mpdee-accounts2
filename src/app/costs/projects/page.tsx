import { prisma } from '@/lib/db'
import { requireWrite } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { localProjectInventory } from '@/lib/costs/local-project-inventory'
import { ProjectMatrix } from './ProjectMatrix'
export const dynamic = 'force-dynamic'
export default async function ProjectsPage() {
  await requireWrite()
  const [projects,clients,policies,workspaces] = await Promise.all([
    prisma.costProject.findMany({where:{archived:false},orderBy:{name:'asc'},include:{mappings:true}}),
    prisma.client.findMany({where:{isArchived:false},orderBy:{name:'asc'},select:{id:true,name:true}}),
    prisma.costPolicy.findMany({orderBy:{effectiveAt:'desc'}}),
    prisma.costUsageEvent.findMany({where:{workspaceRef:{not:null}},distinct:['workspaceRef'],select:{workspaceRef:true},take:1000}),
  ])
  return <div className="space-y-6"><PageHeader title="Projects & connections" description="Link each project to its client, charging rules and source accounts in one place."/><ProjectMatrix localProjectInventory={localProjectInventory} projects={projects.map(p=>({id:p.id,name:p.name,slug:p.slug,repository:p.repository,clientId:p.clientId,mappings:p.mappings.map(m=>({type:m.type,value:m.value}))}))} clients={clients} policies={policies.map(p=>({...p,effectiveAt:p.effectiveAt.toISOString().slice(0,10)}))} observedWorkspaces={workspaces.flatMap(w=>w.workspaceRef?[w.workspaceRef]:[])}/></div>
}
