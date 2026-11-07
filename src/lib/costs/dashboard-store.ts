import { createHash } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { customRecurringAdapter } from './custom-recurring-store'
import { createCustomRecurring, editCustomRecurring, CustomRecurringError } from './custom-recurring'
import { persistManualAllocation, manualAllocationInclude, stateFromAllocation, recurringGbpEstimate } from './manual-allocation-store'
import { dashboardSettingsSchema, emptySettings, dashboardPeriod, presetSchema, monthlyProjection, days, expectedTotal } from './dashboard-model'
import { loadDevelopmentReport } from './development-load'
import { decimalUnits, roundRatio, UNIT } from './money'

const key = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/)
const label = z.string().trim().min(1).max(80).regex(/^[^\x00-\x1f\x7f]+$/)
const command = z.discriminatedUnion('operation',[
  z.object({operation:z.literal('category'),expectedRevision:z.number().int().min(0),id:key,name:label}).strict(),
  z.object({operation:z.literal('categorize'),expectedRevision:z.number().int().min(0),sourceKey:key,categoryId:key}).strict(),
  z.object({operation:z.literal('custom'),expectedRevision:z.number().int().min(0),categoryId:key,mode:z.enum(['create','edit']),record:z.unknown()}).strict(),
  z.object({operation:z.literal('bill'),expectedRevision:z.number().int().min(0),bill:dashboardSettingsSchema.innerType().shape.bills.element}).strict(),
  z.object({operation:z.literal('allocation'),record:z.unknown()}).strict(),
])
const hash = (s:string)=>createHash('sha256').update(s).digest('hex').slice(0,24)
const date = (d:Date)=>d.toISOString().slice(0,10)
const categoryId = (provider:string)=>'provider-'+hash(provider.toLowerCase())
export async function saveDashboard(raw:unknown, actor:{actorType:'machine';actorId:null}|{actorType:'user';actorId:string}) {
  const input=command.parse(raw)
  if(input.operation==='allocation') return persistManualAllocation(input.record,actor.actorId??'machine:mpdee-worker-dashboard')
  return prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(739201685)`
    const row=await tx.costDashboardSettings.findUnique({where:{id:'global'}})
    if((row?.revision??0)!==input.expectedRevision) throw new CustomRecurringError(409,'Costs changed in another window. Reload and try again.')
    const settings=dashboardSettingsSchema.parse(row?.data??emptySettings)
    if(input.operation==='category') {
      const current=settings.categories.find(c=>c.id===input.id)
      if(current) current.name=input.name
      else settings.categories.push({id:input.id,name:input.name})
    } else if(input.operation==='bill') {
      if(!await tx.costCustomRecurring.findUnique({where:{id:input.bill.sourceId}})) throw new CustomRecurringError(404,'Custom cost not found')
      const existing=settings.bills.find(b=>b.id===input.bill.id || (b.sourceId===input.bill.sourceId && b.reference===input.bill.reference))
      if(existing && JSON.stringify(existing)!==JSON.stringify(input.bill)) throw new CustomRecurringError(409,'Bill reference already exists')
      if(!existing) settings.bills.push(input.bill)
    } else {
      if(!settings.categories.some(c=>c.id===input.categoryId) && !input.categoryId.startsWith('provider-')) throw new CustomRecurringError(400,'Choose an existing category')
      if(input.operation==='custom') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(739201683)`
        const store=customRecurringAdapter(tx,actor)
        const saved=input.mode==='create' ? await createCustomRecurring(input.record,store) : await editCustomRecurring(input.record,store)
        settings.assignments['custom:'+saved.id]=input.categoryId
      } else {
        const customId=input.sourceKey.startsWith('custom:')?input.sourceKey.slice(7):null
        const exists=customId ? Boolean(await tx.costCustomRecurring.findUnique({where:{id:customId},select:{id:true}})) :
          (await tx.costSubscriptionInvoice.findMany({select:{provider:true,accountRef:true}})).some(x=>'invoice:'+hash(x.provider+'|'+x.accountRef)===input.sourceKey)
        if(!exists)throw new CustomRecurringError(404,'Cost source not found')
        settings.assignments[input.sourceKey]=input.categoryId
      }
    }
    // Validate limits before persisting. Provider defaults are materialised on first assignment.
    const providers=await tx.costSubscriptionInvoice.findMany({select:{provider:true},distinct:['provider']})
    const custom=await tx.costCustomRecurring.findMany({select:{provider:true},distinct:['provider']})
    for(const {provider} of [...providers,...custom]) {
      const id=categoryId(provider)
      if(!settings.categories.some(c=>c.id===id))settings.categories.push({id,name:provider})
    }
    const data=dashboardSettingsSchema.parse(settings), revision=(row?.revision??0)+1
    await tx.costDashboardSettings.upsert({where:{id:'global'},create:{id:'global',data,revision},update:{data,revision}})
    await tx.auditLog.create({data:{userId:actor.actorId,action:'cost_dashboard_'+input.operation,entityType:'CostDashboardSettings',entityId:'global',details:JSON.stringify({actor:actor.actorType,revision,change:input})}})
    return {revision}
  },{timeout:15000,maxWait:10000})
}

export async function loadDashboard(preset: z.infer<typeof presetSchema>, now=new Date()) {
  const period=dashboardPeriod(preset,now)
  const [row,invoices,custom,projects,fx,report]=await Promise.all([
    prisma.costDashboardSettings.findUnique({where:{id:'global'}}),
    prisma.costSubscriptionInvoice.findMany({take:5001,orderBy:{invoiceDate:'desc'},include:{manualAllocation:{include:manualAllocationInclude}}}),
    prisma.costCustomRecurring.findMany({take:5001,include:{manualAllocation:{include:manualAllocationInclude}}}),
    prisma.costProject.findMany({where:{archived:false},select:{id:true,name:true},orderBy:{name:'asc'},take:5001}),
    prisma.costFxRate.findMany({where:{date:{gte:new Date(Date.parse(period.from)-7*86400000),lte:now}}}),
    loadDevelopmentReport({from:period.from,to:period.to,groupBy:'month'}),
  ])
  if([invoices,custom,projects].some(rows=>rows.length>5000)) throw new CustomRecurringError(400,'Cost source limit exceeded; use Accounts to review this period')
  const settings=dashboardSettingsSchema.parse(row?.data??emptySettings)
  const categories=[...settings.categories]
  const ensure=(provider:string)=>{const id=categoryId(provider);if(!categories.some(c=>c.id===id))categories.push({id,name:provider});return id}
  const quotes=fx.map(r=>({currency:r.currency,date:date(r.date),rate:r.gbpRate.toString(),source:r.source}))
  const convert=(amount:number,currency:string,day:string)=>amount===0?0:recurringGbpEstimate(amount,currency,day,quotes).gbpEstimatePence
  const sources: {key:string;id:string;kind:string;name:string;provider:string;categoryId:string;currency:string;amountMinor:number;confirmed:number|null;projected:number|null;basis:string;allocation:ReturnType<typeof stateFromAllocation>;custom?:unknown}[]=[]
  const groups=new Map<string,typeof invoices>()
  for(const invoice of invoices) {const key='invoice:'+hash(invoice.provider+'|'+invoice.accountRef);const group=groups.get(key)??[];group.push(invoice);groups.set(key,group)}
  for(const [key,group] of groups) {
    // Do not use a later invoice to forecast an earlier selected period.
    const latest=group.find(x=>date(x.invoiceDate)<period.to)
    if(!latest)continue
    const billed=group.filter(x=>date(x.invoiceDate)>=period.from&&date(x.invoiceDate)<period.to)
    const confirmed=billed.reduce((sum,x)=>sum+x.gbpEstimatePence,0)
    const cycle=days(date(latest.periodStart),date(latest.periodEnd))
    const estimate=cycle>0 ? Math.round(latest.gbpEstimatePence*days(period.from,period.to)/cycle) : null
    sources.push({key,id:latest.id,kind:'subscription_invoice',name:latest.provider+' subscription',provider:latest.provider,categoryId:settings.assignments[key]??ensure(latest.provider),currency:latest.currency,amountMinor:latest.grossMinor,confirmed,projected:expectedTotal(confirmed,estimate),basis:'Forecast uses the latest bill and its service-period daily rate. Confirmed is grouped by invoice date.',allocation:stateFromAllocation(latest.manualAllocation)})
    // Each invoice remains individually assignable, including older bills in this period.
  }
  for(const cost of custom) {
    const key='custom:'+cost.id, bills=settings.bills.filter(b=>b.sourceId===cost.id&&b.date>=period.from&&b.date<period.to)
    const values=bills.map(b=>convert(b.amountMinor,b.currency,b.date))
    const confirmed=values.some(x=>x===null)?null:values.reduce<number>((sum,x)=>sum+(x??0),0)
    const original=cost.active ? monthlyProjection(cost.amountMinor,date(cost.effectiveStart),cost.effectiveEnd?date(cost.effectiveEnd):null,period.from,period.to):0
    const projected=convert(original,cost.currency,period.today<period.to?period.today:new Date(Date.parse(period.to)-86400000).toISOString().slice(0,10))
    sources.push({key,id:cost.id,kind:'custom_recurring',name:cost.name,provider:cost.provider,categoryId:settings.assignments[key]??ensure(cost.provider),currency:cost.currency,amountMinor:cost.amountMinor,confirmed,projected:confirmed===null?null:expectedTotal(confirmed,projected),basis:'Monthly commitment, prorated for active dates. Only recorded bills count as Confirmed. Foreign currency forecasts use available reference FX.',allocation:stateFromAllocation(cost.manualAllocation,cost.projectId),custom:{...cost,manualAllocation:undefined,effectiveStart:date(cost.effectiveStart),effectiveEnd:cost.effectiveEnd?date(cost.effectiveEnd):null}})
  }
  // Usage is separate evidence: never add task estimates or nominal grant value to billed subscriptions.
  const usage=report.providerDailyAggregates.totals.map(r=>({provider:r.provider,currency:r.currency,reported:r.reportedValue.amount,cash:r.evidencedCash.amount,coverage:r.coverage,records:r.records}))
  for(const value of report.providerDailyAggregates.totals) {
    if(sources.some(s=>s.provider.toLowerCase()===value.provider.toLowerCase()))continue
    const recorded=value.evidencedCashGbp.amount
    const spent=recorded===null?null:Number(roundRatio(decimalUnits(recorded)*BigInt(100),UNIT))
    const elapsed=Math.min(days(period.from,period.to),Math.max(1,days(period.from,period.today)+1))
    // Project only evidenced expenditure, never nominal grant value or per-task estimates.
    const forecast=spent===null?null:Math.round(spent*days(period.from,period.to)/elapsed)
    sources.push({key:'usage:'+value.provider,id:value.provider,kind:'usage',name:value.provider+' usage',provider:value.provider,categoryId:ensure(value.provider),currency:value.currency,amountMinor:value.reportedValue.amount===null?0:Number(roundRatio(decimalUnits(value.reportedValue.amount)*BigInt(100),UNIT)),confirmed:0,projected:forecast,basis:'Usage run-rate estimate from recorded expenditure. Missing expenditure or FX evidence means the forecast is unavailable; reported usage value alone is not a bill.',allocation:stateFromAllocation(null)})
  }
  const cards=categories.map(c=>{
    const costs=sources.filter(s=>s.categoryId===c.id)
    const total=(field:'confirmed'|'projected')=>costs.some(s=>s[field]===null)?null:costs.reduce((sum,s)=>sum+(s[field]??0),0)
    return {...c,confirmed:total('confirmed'),projected:total('projected'),count:costs.length}
  })
  return {version:'mpdee-cost-dashboard-v1',revision:row?.revision??0,period,categories:cards,sources,projects,usage,
    invoices:invoices.filter(x=>date(x.invoiceDate)>=period.from&&date(x.invoiceDate)<period.to).map(x=>({id:x.id,name:x.provider+' / '+x.invoiceNumber,kind:'subscription_invoice',allocation:stateFromAllocation(x.manualAllocation)})),
    bills:settings.bills,notice:'Confirmed means billed, not proof of payment. Projected is the full expected period total, including Confirmed. GBP conversions are estimates. Usage and task measurements are kept separate to avoid counting the same cost twice.'}
}
