'use server'
import {requireAuth,requireWrite} from '@/lib/auth'
import {ledger,costTransaction} from '@/lib/costs/service'
import {ledgerFx} from '@/lib/costs/fx'
import {revalidatePath} from 'next/cache'
export async function retainReferenceRates(_state:{message:string;error:boolean},form:FormData) {
 await requireWrite()
 const actor=await requireAuth()
 const month=String(form.get('month')??''),project=String(form.get('project')??'')
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return {message:'Choose a valid ledger month.',error:true}
 try{
  const data=await ledger(month,project||undefined),fx=await ledgerFx(data.rows)
  const rates=Array.from(new Map(fx.quotes.filter(q=>q?.source.startsWith('https://www.ecb.europa.eu/')).map(q=>[`${q!.currency}:${q!.date}`,q!])).values())
  if(!rates.length)return {message:'No reference rates are available to retain. Imported rates stay on their original records.',error:false}
  await costTransaction(async tx=>{
   for(const q of rates)await tx.costFxRate.upsert({where:{currency_date:{currency:q.currency,date:new Date(q.date)}},create:{currency:q.currency,date:new Date(q.date),gbpRate:q.rate,source:q.source},update:{}})
   await tx.auditLog.create({data:{userId:actor.id,action:'costs.fx.retain',entityType:'CostFxRate',details:JSON.stringify({month,project:project||null,count:rates.length})}})
  })
  revalidatePath('/costs');return {message:`${rates.length} dated reference rates retained. Original amounts and invoices are unchanged.`,error:false}
 }catch{return {message:'Rates could not be retained. Please retry when the rate service is available.',error:true}}
}
