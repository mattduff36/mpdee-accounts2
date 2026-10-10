import { prisma } from '@/lib/db'
import { requireWrite } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { localProjectInventory } from '@/lib/costs/local-project-inventory'
import { loadCalculationSettings } from '@/lib/costs/calculation-settings-load'
import { ProjectMatrix } from './ProjectMatrix'
import { ProjectCalculationPanel } from './ProjectCalculationPanel'
export const dynamic = 'force-dynamic'
export default async function ProjectsPage() {
  await requireWrite()
  const [projects, clients, policies, workspaces, settings] = await Promise.all([
    prisma.costProject.findMany({ where: { archived: false }, orderBy: { name: 'asc' }, include: { mappings: true } }),
    prisma.client.findMany({ where: { isArchived: false }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.costPolicy.findMany({ orderBy: { effectiveAt: 'desc' } }),
    prisma.costUsageEvent.findMany({ where: { workspaceRef: { not: null } }, distinct: ['workspaceRef'], select: { workspaceRef: true }, take: 1000 }),
    loadCalculationSettings(),
  ])
  return <div className="space-y-6"><PageHeader title="Projects & connections" description="Link each project to its client, charging rules and source accounts in one place."/><ProjectCalculationPanel globalRates={settings.global} globalRevision={settings.globalRevision} projects={projects.map(project => ({ id: project.id, name: project.name, slug: project.slug, revision: settings.resolve(project.id).revision, overrides: settings.projects.get(project.id) ?? null, effective: settings.resolve(project.id).rates }))} /><ProjectMatrix localProjectInventory={localProjectInventory} projects={projects.map(p => ({ id: p.id, name: p.name, slug: p.slug, repository: p.repository, clientId: p.clientId, mappings: p.mappings.filter(m => m.type !== 'invoice-project').map(m => ({ type: m.type, value: m.value })) }))} clients={clients} policies={policies.map(p => ({ id: p.id, projectId: p.projectId, clientId: p.clientId, effectiveAt: p.effectiveAt.toISOString().slice(0, 10), effectiveUntil: p.effectiveUntil?.toISOString().slice(0, 10) ?? null, billable: p.billable, includedBaseBps: p.includedBaseBps, markupBps: p.markupBps, infrastructureMarkupBps: p.infrastructureMarkupBps, vercelDailyPence: p.vercelDailyPence }))} observedWorkspaces={workspaces.flatMap(w => w.workspaceRef ? [w.workspaceRef] : [])} /></div>
}
