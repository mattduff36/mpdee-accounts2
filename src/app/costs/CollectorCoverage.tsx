import { prisma } from '@/lib/db'
import { collectorStatusSchema,collectorLabels,cursorAccounts } from '@/lib/costs/collector-status'
export async function CollectorCoverage(){
 const latest=await prisma.auditLog.findFirst({where:{entityType:'CostCollector',entityId:'cursor-four-accounts',action:'costs.collector.status'},orderBy:{createdAt:'desc'},select:{details:true}})
 let report:ReturnType<typeof collectorStatusSchema.parse>|null=null
 try{report=collectorStatusSchema.parse(JSON.parse(latest?.details||'null'))}catch{}
 const stale=!report||Date.now()-Date.parse(report.finishedAt)>3*3600000
 const healthy=!stale&&report?.succeeded===4&&report.uploadState==='success'
 return <section className={`rounded-2xl border p-5 ${healthy?'border-emerald-200 bg-emerald-50/50':'border-amber-200 bg-amber-50/60'}`} aria-label="Cursor account collection coverage">
  <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold text-slate-900">Cursor accounts · {report?.succeeded??0}/4 checked in the last reported run</h2><span className="text-sm text-slate-700">{stale?'Collector status needs attention':healthy?'Collection and upload succeeded':'Partial coverage'}</span></div>
  <ul className="mt-3 grid gap-2 sm:grid-cols-2">{cursorAccounts.map(email=>{const account=report?.accounts.find(a=>a.email===email);return <li key={email} className="rounded-lg bg-white/70 px-3 py-2 text-sm"><span className="block break-all font-medium">{email}</span><span className="text-slate-600">{account?collectorLabels[account.state]:'No four-account status received'}{stale&&account?' · status stale':''}</span></li>})}</ul>
  <p className="mt-3 text-xs leading-relaxed text-slate-700">{report?`Last reported check: ${report.finishedAt.replace('T',' ').slice(0,16)} UTC. ${report.uploadState==='success'?'Saved usage uploaded.':report.uploadState==='failed'?'Upload incomplete; retained locally for retry.':'Usage has not been uploaded by this run.'} `:''}Checks cover the collector’s requested windows, not a guarantee of complete historical billing coverage. Missing accounts are not zero usage.</p>
 </section>
}
