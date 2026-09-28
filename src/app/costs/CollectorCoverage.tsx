import { prisma } from '@/lib/db'
import { collectorStatusSchema, collectorLabels, cursorAccounts, collectorRunHealth, recoveredCompleteDay } from '@/lib/costs/collector-status'
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC'
export async function CollectorCoverage() {
 const latest=await prisma.auditLog.findFirst({where:{entityType:'CostCollector',entityId:'cursor-four-accounts',action:'costs.collector.status'},orderBy:{createdAt:'desc'},select:{details:true}})
 let report:ReturnType<typeof collectorStatusSchema.parse>|null=null
 try{report=collectorStatusSchema.parse(JSON.parse(latest?.details||'null'))}catch{}
 const {stale,activeMode,active,catchingUp,healthy}=collectorRunHealth(report)
 return <section className={`scroll-mt-20 rounded-2xl border p-5 ${healthy?'border-emerald-200 bg-emerald-50/50':'border-amber-200 bg-amber-50/60'}`} aria-label="Cursor account collection coverage">
  <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold text-slate-900">{activeMode?'Cursor accounts · hourly collection':`Cursor accounts · ${report?.succeeded??0}/4 checked in the last reported run`}</h2><span className="text-sm text-slate-700">{stale?'Collector status needs attention':activeMode&&!active?'No supported Cursor account signed in':healthy?'Collection and upload succeeded':catchingUp?'Catching up on missed usage':activeMode?'Current account needs attention':'Partial coverage'}</span></div>
  <p className="mt-1 text-sm text-slate-600">{activeMode?'The collector checks the account currently signed into Cursor each hour. Other accounts resume when next used.':'Three primary accounts, plus Hotmail monitored for occasional use.'}</p>
  <ul className="mt-3 grid gap-3 sm:grid-cols-2">{cursorAccounts.map(email=>{
   const account=report?.accounts.find(a=>a.email===email)
   return <li key={email} className="rounded-xl border border-white bg-white/80 p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-1"><span className="break-all font-medium text-slate-900">{email}</span><span className="text-xs text-slate-500">{email==='mattduff36@hotmail.com'?'Occasional · monitored':'Primary account'}</span></div>
    <p className={`mt-1 font-medium ${account?.state==='inactive'?'text-slate-600':account?.state==='success'&&!stale&&!account.catchingUp?'text-emerald-800':'text-amber-800'}`}>{account?account.state==='success'&&account.catchingUp?'Catching up on missed usage':collectorLabels[account.state]:'No collection status received'}{stale&&account&&account.state!=='inactive'?' · status stale':''}</p>
    <dl className="mt-2 space-y-1 text-xs leading-relaxed text-slate-600">
     <div><dt className="inline">Last successful collection: </dt><dd className="inline">{account?.lastSuccessAt?<time dateTime={account.lastSuccessAt}>{dateLabel(account.lastSuccessAt)}</time>:'Not recorded'}</dd></div>
     <div><dt className="inline">Complete days recovered through: </dt><dd className="inline">{account?.coveredThrough?<time dateTime={recoveredCompleteDay(account.coveredThrough)}>{new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(recoveredCompleteDay(account.coveredThrough)))} (UTC)</time>:'Unknown'}</dd></div>
    </dl>
    {account?.catchingUp&&account.state!=='success'&&account.state!=='inactive'&&<p className="mt-1 text-xs text-amber-800">Missed usage still needs to be recovered.</p>}
   </li>
  })}</ul>
  <div className="mt-3 space-y-1 text-xs leading-relaxed text-slate-700">
   {report&&<p>Last reported check: <time dateTime={report.finishedAt}>{dateLabel(report.finishedAt)}</time>. {report.uploadState==='success'?'This run uploaded its saved usage.':report.uploadState==='failed'?'Upload incomplete; saved usage is retained locally for retry.':'This run did not upload usage.'}</p>}
   <p>Last successful upload: {report?.lastUploadSuccessAt?<time dateTime={report.lastUploadSuccessAt}>{dateLabel(report.lastUploadSuccessAt)}</time>:'Not recorded'}.</p>
   <p>Recovered dates cover complete UTC days from the collector’s recorded starting point, not complete lifetime history or confirmed billing. Current-day usage can arrive before that date advances. Collection and upload are separate. Inactive or missing accounts do not mean zero usage.</p>
  </div>
 </section>
}
