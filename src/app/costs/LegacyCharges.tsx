import Link from 'next/link'
import { prisma } from '@/lib/db'
import { formatCurrency } from '@/lib/format'
import { panel } from './ui'

export async function LegacyCharges({start,end,month,project,requestedPage,usagePage}:{start:Date;end:Date;month:string;project?:string;requestedPage?:string;usagePage?:string}) {
 if(project==='unassigned') return null
 const where={periodStart:{gte:start,lt:end},...(project?{projectId:project}:{})}
 const [totals,nonzeroCount]=await Promise.all([
  prisma.costLegacyCharge.groupBy({by:['category'],where,_sum:{frozenGbpPence:true},_count:{_all:true},orderBy:{category:'asc'}}),
  prisma.costLegacyCharge.count({where:{...where,frozenGbpPence:{not:0}}}),
 ])
 const totalCount=totals.reduce((s,t)=>s+t._count._all,0)
 if(!totalCount)return null
 const subtotal=totals.reduce((s,t)=>s+(t._sum.frozenGbpPence??0),0),pageCount=Math.max(1,Math.ceil(nonzeroCount/20)),requested=Number(requestedPage),page=Math.min(pageCount,Number.isSafeInteger(requested)&&requested>0?requested:1)
 const details=await prisma.costLegacyCharge.findMany({where:{...where,frozenGbpPence:{not:0}},orderBy:[{periodStart:'desc'},{id:'asc'}],skip:(page-1)*20,take:20,select:{id:true,label:true,category:true,periodStart:true,periodEnd:true,frozenGbpPence:true,invoiceability:true,sourceSystem:true,sourceKind:true,sourceBucket:true,project:{select:{name:true}}}})
 const href=(p:number)=>'/costs?'+new URLSearchParams({month,project:project??'',page:usagePage??'1',legacyPage:String(p)})+'#legacy-charges'
 const categoryLabel=(category:string)=>({CURSOR:'Cursor charges',VERCEL_HOSTING:'Hosting & membership',DATABASE:'Database charges',OTHER:'Other charges & credits'}[category]??category.replaceAll('_',' '))
 return <section id="legacy-charges" className={`${panel} border-blue-200 bg-blue-50/30`} aria-labelledby="legacy-charges-title">
  <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 id="legacy-charges-title" className="font-semibold">Reviewed legacy client charges</h2><p className="mt-1 text-sm text-slate-600">Frozen amounts carried forward from the original iTrader ledger.</p></div><div><p className="text-xs font-medium text-slate-500">Filtered legacy subtotal</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatCurrency(subtotal)}</p></div></div>
  <p className="mt-4 max-w-4xl text-sm leading-relaxed text-slate-700">These historical client charges preserve hosting, membership allocations and signed credits. They are separate from the usage estimates above, provider expenses and profit calculations. Overlapping usage must be reconciled before combining the two. This subtotal is not an outstanding payment balance.</p>
  <p className="mt-2 text-xs text-slate-500">The original service-period start determines the month. Each exact frozen amount is counted once, without prorating.</p>
  <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{totals.map(t=><div className="rounded-xl border border-slate-200 bg-white p-3" key={t.category}><dt className="text-sm text-slate-600">{categoryLabel(t.category)}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(t._sum.frozenGbpPence)}</dd><dd className="text-xs text-slate-500">{t._count._all} source records</dd></div>)}</dl>
  <details className="mt-5" open={page>1}><summary className="cursor-pointer text-sm font-semibold">Reviewed source details</summary><p className="my-3 text-sm text-slate-600">{nonzeroCount} non-zero records · {totalCount-nonzeroCount} zero-value records retained. Page {page} of {pageCount}.</p>
   <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead><tr><th className="py-3 text-left">Service period</th><th className="py-3 text-left">Source</th><th className="py-3 text-right">Amount</th><th className="py-3 text-left">What it is</th></tr></thead><tbody>{details.map((item,i)=><tr key={item.id} className={i%2?'bg-white/70':''}><td className="py-3 pr-3 align-top text-xs tabular-nums">{item.periodStart.toISOString().slice(0,10)} – {item.periodEnd.toISOString().slice(0,10)}<p className="text-slate-500">End date is exclusive</p></td><td className="py-3 pr-3 align-top text-xs"><p className="font-medium text-slate-700">{item.sourceSystem} · {item.sourceKind}</p><p className="mt-1 break-all text-slate-500">{item.sourceBucket}</p></td><td className="py-3 pr-3 text-right align-top font-semibold tabular-nums">{formatCurrency(item.frozenGbpPence)}</td><td className="py-3 align-top"><p className="break-words font-medium">{item.label}</p><p className="mt-1 text-xs text-slate-600">{item.project.name} · {categoryLabel(item.category)} · {item.invoiceability==='INVOICEABLE'?'Source marked invoiceable':'Source marked provisional'}</p></td></tr>)}</tbody></table></div>
   <nav aria-label="Legacy charge pages" className="mt-3 flex justify-between text-sm">{page>1?<Link className="text-blue-700 underline" href={href(page-1)}>Previous source records</Link>:<span/>}{page<pageCount&&<Link className="text-blue-700 underline" href={href(page+1)}>Next source records</Link>}</nav>
  </details>
 </section>
}
