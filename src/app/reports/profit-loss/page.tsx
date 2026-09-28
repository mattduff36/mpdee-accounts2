import Link from 'next/link'
import { prisma } from '@/lib/db'
import { andVisibleInvoice, visiblePaymentWhere } from '@/lib/invoice-visibility'
import { formatCurrency, formatDate } from '@/lib/format'
import { PageHeader } from '@/components/PageHeader'

export default async function ProfitLossPage() {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(),0,1))
  const [payments, expenses, paidWithoutRecords] = await Promise.all([
    prisma.payment.findMany({where:{AND:[visiblePaymentWhere,{date:{gte:start,lte:now}}]},select:{amount:true,isRefund:true}}),
    prisma.expense.aggregate({_sum:{grossAmount:true},where:{isArchived:false,date:{gte:start,lte:now}}}),
    prisma.invoice.count({where:andVisibleInvoice({status:'paid',paidAt:{gte:start,lte:now},payments:{none:{}}})}),
  ])
  const receipts=payments.reduce((sum,p)=>sum+(p.isRefund?-Math.abs(p.amount):p.amount),0)
  const spending=expenses._sum.grossAmount??0
  const difference=receipts-spending
  return <div className="space-y-6">
    <PageHeader title="Collections & recorded spending" description={`1 January–${formatDate(now)} · year to date · GBP including VAT`}><Link href="/costs/analysis" className="text-sm font-semibold text-blue-700 hover:underline">Project & client profitability →</Link></PageHeader>
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">This compares recorded customer payments with expenses dated in the same period. It is not accounting profit or a bank cashflow statement: invoices and expenses can cover different work periods, and an expense date does not prove payment. Use the profitability analysis for allocated project costs.</div>
    {paidWithoutRecords>0&&<p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{paidWithoutRecords} paid invoice{paidWithoutRecords===1?' has':'s have'} no payment records. Their receipt dates and amounts are not included here; reconcile payment history before treating this as complete.</p>}
    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-6"><p className="text-sm text-slate-600">Recorded collections</p><p className="mt-2 text-3xl font-bold text-emerald-700">{formatCurrency(receipts)}</p><p className="mt-2 text-xs text-slate-500">By payment date, less refunds. Includes partial payments.</p></div>
      <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-6"><p className="text-sm text-slate-600">Recorded spending</p><p className="mt-2 text-3xl font-bold text-rose-700">{formatCurrency(spending)}</p><p className="mt-2 text-xs text-slate-500">By expense date, including VAT. Archived expenses excluded.</p></div>
      <div className="rounded-xl border bg-white p-6"><p className="text-sm text-slate-600">Collections less recorded spending</p><p className={`mt-2 text-3xl font-bold ${difference>=0?'text-emerald-700':'text-rose-700'}`}>{formatCurrency(difference)}</p><p className="mt-2 text-xs text-slate-500">A period comparison, not net profit.</p></div>
    </div>
  </div>
}
