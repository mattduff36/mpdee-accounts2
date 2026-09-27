import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireWrite, requireAuth } from '@/lib/auth'
import { costTransaction } from '@/lib/costs/service'
import { unitsText } from '@/lib/costs/money'
import { PageHeader } from '@/components/PageHeader'
import { panel, inputClass, buttonClass } from '../ui'
export const dynamic = 'force-dynamic'
export default async function ReviewPage({ searchParams }: { searchParams: { message?: string } }) {
  await requireWrite()
  const [events,projects] = await Promise.all([
    prisma.costUsageEvent.findMany({ where: { projectId: null }, orderBy: { occurredAt: 'desc' }, take: 100, include: { revisions: { orderBy: { revision: 'desc' }, take: 1 } } }),
    prisma.costProject.findMany({ orderBy: { name: 'asc' } }),
  ])
  async function assign(form: FormData) {
    'use server'
    await requireWrite()
    const actor = await requireAuth()
    const id = String(form.get('eventId') ?? ''), projectId=String(form.get('projectId') ?? ''), reason=String(form.get('reason') ?? '').trim()
    if (!reason || reason.length>500 || !projectId) redirect('/costs/review?message=Choose+a+project+and+record+why+it+is+correct.')
    try {
      await costTransaction(async tx => {
        const before=await tx.costUsageEvent.findUniqueOrThrow({where:{id}})
        await tx.costUsageEvent.update({where:{id},data:{projectId,attribution:'manual',manualAssignment:true}})
        await tx.auditLog.create({data:{userId:actor.id,action:'costs.event.assign',entityType:'CostUsageEvent',entityId:id,details:JSON.stringify({before:before.projectId,after:projectId,reason})}})
      })
    } catch { redirect('/costs/review?message=Assignment+could+not+be+saved.') }
    revalidatePath('/costs');redirect('/costs/review?message=Assignment+saved.+Future+imports+will+preserve+it.')
  }
  return <div className="space-y-6"><PageHeader title="Unassigned usage" description="Assign only when you can identify the project. All other records stay visible and excluded from client estimates."><Link href="/costs">Back to ledger</Link></PageHeader>{searchParams.message && <p role="status" className={panel}>{searchParams.message}</p>}<p className="text-sm text-slate-600">Latest 100 unassigned events across all dates. For many events from the same workspace or conversation, add a mapping under Projects & rates and re-import instead. Assignment does not clear a monetary or coverage review hold.</p>{events.map(e=><div key={e.id} className={`${panel} space-y-3`}><div className="flex justify-between gap-4"><h2 className="font-semibold">{e.provider} · {e.model ?? 'Infrastructure'}</h2><span className="text-sm">{e.occurredAt.toISOString()}</span></div><p className="text-sm">{e.revisions[0]?.funding} · {e.revisions[0]?.nominalUnits == null ? 'Unknown nominal amount' : `${e.revisions[0].currency} ${unitsText(e.revisions[0].nominalUnits)}`} · {e.attribution}</p><dl className="break-all text-xs text-slate-500"><dt>Workspace</dt><dd>{e.workspaceRef ?? 'Unavailable'}</dd><dt>Conversation mapping reference</dt><dd>{e.conversationId ? `${e.accountRef}/${e.conversationId}` : 'Unavailable'}</dd><dt>Resource</dt><dd>{e.resourceRef ?? 'Unavailable'}</dd></dl><form action={assign} className="grid gap-3 md:grid-cols-3"><input type="hidden" name="eventId" value={e.id}/><label className="text-sm">Project<select name="projectId" className={inputClass} required><option value="">Choose project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="text-sm">Reason<input name="reason" className={inputClass} required maxLength={500}/></label><button className={`${buttonClass} self-end`}>Assign this event</button></form></div>)}{events.length===0 && <p className={panel}>No unassigned events.</p>}</div>
}
