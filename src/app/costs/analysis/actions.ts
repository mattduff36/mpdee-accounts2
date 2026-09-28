'use server'
import { requireAuth, requireWrite } from '@/lib/auth'
import { costTransaction } from '@/lib/costs/service'
import { parsePeriod, splitPence, validAllocation } from '@/lib/costs/profitability'
import { revalidatePath } from 'next/cache'
const value = (form: FormData, key: string) => String(form.get(key) || '').trim()
const done = (message: string) => { revalidatePath('/costs/analysis'); revalidatePath('/dashboard'); return { message, error: false } }
const fail = (error: unknown) => ({ message: error instanceof Error && !error.message.includes('prisma') ? error.message : 'Could not save. Refresh and try again.', error: true })
export async function saveInvoiceAssociation(_state: {message:string;error:boolean}, form: FormData) {
 await requireWrite(); const user = await requireAuth()
 try {
  const invoiceId = value(form,'invoiceId'), projectId=value(form,'projectId'), note=value(form,'note')
  const period=parsePeriod(value(form,'start'),value(form,'end'))
  if (!note || note.length>1000) throw new Error('Add a brief explanation (up to 1,000 characters).')
  await costTransaction(async tx => {
   const [invoice,project]=await Promise.all([tx.invoice.findFirst({where:{id:invoiceId,viewHidden:false}}),tx.costProject.findFirst({where:{id:projectId,archived:false}})])
   if(!invoice || !project) throw new Error('Choose an available invoice and project.')
   if(project.clientId!==invoice.clientId) throw new Error('Link the project to this invoice’s client in Projects & rates first.')
   if(['draft','cancelled'].includes(invoice.status)) throw new Error('Use an issued invoice; drafts and cancelled invoices are excluded.')
   await tx.invoiceCostAssociation.upsert({where:{invoiceId},create:{invoiceId,projectId,...period,note},update:{projectId,...period,note}})
   await tx.auditLog.create({data:{userId:user.id,action:'cost_invoice_association',entityType:'Invoice',entityId:invoiceId,details:JSON.stringify({projectId,...period,note})}})
  }); return done('Project and service period saved. Invoice cost bars have been recalculated.')
 } catch(error) {return fail(error)}
}
export async function saveExpenseAllocation(_state:{message:string;error:boolean},form:FormData){
 await requireWrite();const user=await requireAuth()
 try{
  const expenseId=value(form,'expenseId'),projectId=value(form,'projectId'),kind=value(form,'kind'),note=value(form,'note'),raw=value(form,'amount')
  const period=parsePeriod(value(form,'start'),value(form,'end'))
  if(!/^-?\d{1,8}(\.\d{1,2})?$/.test(raw))throw new Error('Enter a GBP amount with at most two decimal places.')
  const amountPence=Math.round(Number(raw)*100)
  if(!['direct','subscription'].includes(kind)||!note||note.length>1000)throw new Error('Choose a cost type and add a brief explanation.')
  await costTransaction(async tx=>{
   const [expense,project]=await Promise.all([tx.expense.findFirst({where:{id:expenseId,isArchived:false},include:{costAllocations:true}}),tx.costProject.findFirst({where:{id:projectId,archived:false}})])
   if(!expense||!project)throw new Error('Choose an available expense and project.')
   const other=expense.costAllocations.filter(a=>a.projectId!==projectId).reduce((n,a)=>n+a.amountPence,0)
   if(amountPence!==0&&!validAllocation(expense.netAmount,amountPence,other))throw new Error('Allocations must have the expense’s sign and cannot exceed its net GBP amount. Use a negative share for a refund.')
   if(amountPence===0)await tx.costExpenseAllocation.deleteMany({where:{expenseId,projectId}})
   else await tx.costExpenseAllocation.upsert({where:{expenseId_projectId:{expenseId,projectId}},create:{expenseId,projectId,amountPence,kind,...period,note},update:{amountPence,kind,...period,note}})
   await tx.auditLog.create({data:{userId:user.id,action:'cost_expense_allocation',entityType:'Expense',entityId:expenseId,details:JSON.stringify({projectId,amountPence,kind,...period,note})}})
  });return done('Expense share saved. The original expense is unchanged; the share is counted once.')
 }catch(error){return fail(error)}
}
export async function allocateSubscription(_state:{message:string;error:boolean},form:FormData){
 await requireWrite();const user=await requireAuth()
 try{
 const expenseId=value(form,'expenseId'),accountRef=value(form,'accountRef'),period=parsePeriod(value(form,'start'),value(form,'end'))
 if(!accountRef||value(form,'acknowledge')!=='yes')throw new Error('Choose the source account and acknowledge the provisional coverage.')
 let count=0,held=0
 await costTransaction(async tx=>{
  const expense=await tx.expense.findFirst({where:{id:expenseId,isArchived:false},include:{costAllocations:true}})
  if(!expense)throw new Error('Choose an available subscription expense.')
  if(expense.costAllocations.length)throw new Error('This bill already has shares. Edit those shares manually to preserve your review.')
  const end=new Date(period.periodEnd.getTime()+86400000)
  const events=await tx.costUsageEvent.findMany({where:{provider:'cursor',accountRef,occurredAt:{gte:period.periodStart,lt:end}},include:{revisions:{orderBy:{revision:'desc'},take:1}},take:50001})
  if(!events.length||events.length>50000)throw new Error('A usable usage window (1–50,000 events) is required.')
  const included=events.filter(e=>e.revisions[0]?.funding==='included')
  if(!included.length)throw new Error('No included usage exists for this account and period.')
  if(included.some(e=>e.revisions[0].nominalUnits===null||e.revisions[0].quality!=='complete'))throw new Error('Some included records need monetary review. Resolve them before allocating this bill.')
  if(new Set(included.map(e=>e.revisions[0].currency)).size!==1)throw new Error('Mixed source currencies cannot be used as comparable usage weights.')
  const weights=new Map<string,bigint>()
  for(const event of included){const id=event.projectId||'unassigned';weights.set(id,(weights.get(id)||BigInt(0))+(event.revisions[0].nominalUnits||BigInt(0)))}
  const shares=splitPence(expense.netAmount,Array.from(weights).map(([id,weight])=>({id,weight})))
  if(!shares.size)throw new Error('Usage value is zero; enter reviewed manual shares instead.')
  held=shares.get('unassigned')||0
  const note=`Provisional included-usage allocation for Cursor account ${accountRef}; ${included.length} imported events. Coverage is not proven complete. Unassigned share ${held} pence retained. Review against full billing cycle.`
  for(const [projectId,amountPence]of Array.from(shares)){if(projectId==='unassigned'||!amountPence)continue;await tx.costExpenseAllocation.create({data:{expenseId,projectId,amountPence,kind:'subscription',...period,note}});count++}
  await tx.auditLog.create({data:{userId:user.id,action:'cost_subscription_allocation',entityType:'Expense',entityId:expenseId,details:JSON.stringify({count,held,...period,note})}})
 });return done(`Created ${count} provisional project shares. Unassigned share £${(held/100).toFixed(2)} remains unallocated. Review coverage before relying on margins.`)
 }catch(error){return fail(error)}
}
export async function removeInvoiceAssociation(_state:{message:string;error:boolean},form:FormData){
 await requireWrite();const user=await requireAuth()
 try{
  const invoiceId=value(form,'invoiceId')
  await costTransaction(async tx=>{
   const invoice=await tx.invoice.findFirst({where:{id:invoiceId,viewHidden:false}})
   if(!invoice)throw new Error('Invoice not found.')
   await tx.invoiceCostAssociation.deleteMany({where:{invoiceId}})
   await tx.auditLog.create({data:{userId:user.id,action:'cost_invoice_unlink',entityType:'Invoice',entityId:invoiceId,details:'Removed project and service-period association; invoice unchanged.'}})
  });return done('Invoice link removed. Its accounting details are unchanged.')
 }catch(error){return fail(error)}
}
