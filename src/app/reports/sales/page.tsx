import Link from 'next/link'
import { prisma } from '@/lib/db'
import { andVisibleInvoice, visiblePaymentWhere } from '@/lib/invoice-visibility'
import { formatCurrency } from '@/lib/format'
import { PageHeader } from '@/components/PageHeader'

export default async function SalesReportPage() {
  const now=new Date(), yearStart=new Date(Date.UTC(now.getUTCFullYear(),0,1))
  const [invoices,payments]=await Promise.all([
    prisma.invoice.findMany({where:andVisibleInvoice({issueDate:{gte:yearStart,lte:now},status:{notIn:['draft','cancelled']}}),select:{issueDate:true,total:true,balanceDue:true}}),
    prisma.payment.findMany({where:{AND:[visiblePaymentWhere,{date:{gte:yearStart,lte:now}}]},select:{date:true,amount:true,isRefund:true}}),
  ])
  const monthly:Record<string,{issued:number;received:number;outstanding:number}>={}
  for(let month=0;month<=now.getUTCMonth();month++) monthly[`${now.getUTCFullYear()}-${String(month+1).padStart(2,'0')}`]={issued:0,received:0,outstanding:0}
  for(const inv of invoices) { const bucket=monthly[inv.issueDate.toISOString().slice(0,7)];bucket.issued+=inv.total;bucket.outstanding+=inv.balanceDue }
  for(const payment of payments) monthly[payment.date.toISOString().slice(0,7)].received+=payment.isRefund?-Math.abs(payment.amount):payment.amount
  const months=Object.entries(monthly).sort()
  const totals=months.reduce((sum,[,m])=>({issued:sum.issued+m.issued,received:sum.received+m.received,outstanding:sum.outstanding+m.outstanding}),{issued:0,received:0,outstanding:0})
  return <div className="space-y-6">
    <PageHeader title="Sales & collections by month" description={`${now.getUTCFullYear()} to date · GBP including VAT · calendar months in UTC`}><Link href="/costs/analysis" className="text-sm font-semibold text-blue-700 hover:underline">Business analysis →</Link></PageHeader>
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">Invoiced uses the issue date and excludes drafts and cancelled invoices. Collections uses the payment date, includes partial payments and deducts refunds—even for invoices issued in an earlier year. Current outstanding shows the remaining balance on invoices issued in each month, not a historical month-end balance. These columns should not be subtracted from each other.</div>
    <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[620px] text-sm"><caption className="sr-only">Monthly invoicing, recorded customer collections and current outstanding balances</caption><thead><tr className="border-b bg-slate-50">
      <th scope="col" className="px-4 py-3 text-left font-medium text-slate-600">Month</th><th scope="col" className="px-4 py-3 text-right font-medium text-slate-600">Invoiced</th><th scope="col" className="px-4 py-3 text-right font-medium text-slate-600">Recorded collections</th><th scope="col" className="px-4 py-3 text-right font-medium text-slate-600">Current outstanding<br/><span className="text-xs font-normal">From this month’s invoices</span></th>
    </tr></thead><tbody>{months.map(([month,data])=><tr key={month} className="border-b hover:bg-slate-50"><th scope="row" className="px-4 py-3 text-left font-medium">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'})}</th><td className="px-4 py-3 text-right tabular-nums">{formatCurrency(data.issued)}</td><td className="px-4 py-3 text-right tabular-nums text-emerald-700">{formatCurrency(data.received)}</td><td className="px-4 py-3 text-right tabular-nums text-amber-800">{formatCurrency(data.outstanding)}</td></tr>)}</tbody><tfoot><tr className="bg-slate-50 font-semibold"><th scope="row" className="px-4 py-3 text-left">Year to date</th>{[totals.issued,totals.received,totals.outstanding].map((value,i)=><td key={i} className="px-4 py-3 text-right tabular-nums">{formatCurrency(value)}</td>)}</tr></tfoot></table></div>
    {!invoices.length&&!payments.length&&<p className="text-sm text-slate-500">No issued invoices or recorded payments yet this year.</p>}
  </div>
}
