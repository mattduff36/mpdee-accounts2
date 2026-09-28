import { prisma } from "@/lib/db"
import { canWrite, requireAuth } from "@/lib/auth"
import { andVisibleInvoice, visibleInvoiceWhere } from "@/lib/invoice-visibility"
import { formatCurrency, formatDate, startOfYear } from "@/lib/format"
import { monthRange, netAfterExpenses } from "@/lib/dashboard-period"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { StatusBadge } from "@/components/StatusBadge"
import { PageHeader } from "@/components/PageHeader"
import Link from "next/link"
import { TrendingUp, TrendingDown, AlertTriangle, FileText, Users, Receipt, ArrowRight } from "lucide-react"

async function getDashboardData() {
  const now = new Date()
  const yearStart = startOfYear(now)
  const month = monthRange(now)

  const paidInvoices = await prisma.invoice.aggregate({ _sum: { total: true }, where: andVisibleInvoice({ status: "paid", paidAt: { gte: yearStart } }) })
  const paidInvoicesThisMonth = await prisma.invoice.aggregate({ _sum: { total: true }, where: andVisibleInvoice({ status: "paid", paidAt: month }) })
  const unpaidInvoices = await prisma.invoice.aggregate({ _sum: { balanceDue: true }, where: andVisibleInvoice({ status: { in: ["sent", "viewed", "partial"] } }) })
  const overdueWhere = andVisibleInvoice({ status: { in: ["sent", "viewed", "partial", "overdue"] }, dueDate: { lt: now } })
  const overdueInvoices = await prisma.invoice.aggregate({ _sum: { balanceDue: true }, where: overdueWhere })
  const expensesThisMonth = await prisma.expense.aggregate({ _sum: { grossAmount: true }, where: { date: month } })
  const recentInvoices = await prisma.invoice.findMany({ where: visibleInvoiceWhere, take: 5, orderBy: { createdAt: "desc" }, include: { client: { select: { name: true } } } })
  const recentExpenses = await prisma.expense.findMany({ take: 5, orderBy: [{ date: "desc" }, { id: "desc" }], include: { category: { select: { name: true } } } })
  const upcomingDue = await prisma.invoice.findMany({ where: andVisibleInvoice({ status: { in: ["sent", "viewed", "partial"] }, dueDate: { gte: now } }), take: 5, orderBy: { dueDate: "asc" }, include: { client: { select: { name: true } } } })
  const overdue = await prisma.invoice.findMany({ where: overdueWhere, take: 5, orderBy: { dueDate: "asc" }, include: { client: { select: { name: true } } } })
  const clientCount = await prisma.client.count({ where: { isArchived: false } })

  return {
    revenue: paidInvoices._sum.total || 0,
    unpaid: unpaidInvoices._sum.balanceDue || 0,
    overdueTotal: overdueInvoices._sum.balanceDue || 0,
    expenses: expensesThisMonth._sum.grossAmount || 0,
    profit: netAfterExpenses(paidInvoicesThisMonth._sum.total || 0, expensesThisMonth._sum.grossAmount || 0),
    clientCount,
    recentInvoices,
    recentExpenses,
    upcomingDue,
    overdueList: overdue,
  }
}

const metricStyles = {
  emerald: { surface: 'bg-emerald-50/60', icon: 'bg-emerald-50 text-emerald-600 ring-emerald-600/10', value: 'text-emerald-700' },
  blue: { surface: 'bg-blue-50/70', icon: 'bg-blue-50 text-blue-600 ring-blue-600/10', value: 'text-blue-950' },
  rose: { surface: 'bg-rose-50/50', icon: 'bg-rose-50 text-rose-600 ring-rose-600/10', value: 'text-rose-700' },
  slate: { surface: 'bg-slate-50', icon: 'bg-slate-100 text-slate-600 ring-slate-600/10', value: 'text-slate-950' },
}

interface MetricCardProps {
  title: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  tone: keyof typeof metricStyles
}

function MetricCard({ title, value, icon: Icon, tone }: MetricCardProps) {
  const styles = metricStyles[tone]

  return (
    <Card className={`relative flex flex-col overflow-hidden ${styles.surface}`}>
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-sky-400 to-transparent" />
      <CardHeader className="flex min-h-[4.5rem] flex-1 flex-row items-center justify-between pb-2">
        <CardTitle className="max-w-[12ch] text-sm font-semibold leading-5 text-slate-500">{title}</CardTitle>
        <div className={`rounded-xl p-2 ring-1 ring-inset ${styles.icon}`}>
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent className="mt-auto">
        <div className={`text-2xl font-bold tracking-tight ${styles.value}`}>{value}</div>
      </CardContent>
    </Card>
  )
}

export default async function DashboardPage() {
  const user = await requireAuth()
  const writable = canWrite(user)
  const data = await getDashboardData()
  return <div className="space-y-6">
    <PageHeader title="Dashboard" description="Track cashflow, open invoices, and the next accounting actions at a glance." />
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <MetricCard title="Revenue (YTD)" value={formatCurrency(data.revenue)} icon={TrendingUp} tone="emerald" />
      <MetricCard title="Unpaid" value={formatCurrency(data.unpaid)} icon={Receipt} tone="blue" />
      <MetricCard title="Overdue" value={formatCurrency(data.overdueTotal)} icon={AlertTriangle} tone="rose" />
      <MetricCard title="Net after expenses (MTD)" value={formatCurrency(data.profit)} icon={TrendingDown} tone={data.profit >= 0 ? 'emerald' : 'rose'} />
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Recent Invoices</CardTitle></CardHeader><CardContent>
        {data.recentInvoices.length === 0 ? <p className="text-sm text-slate-500">No invoices yet</p> : <div className="space-y-2">{data.recentInvoices.map(inv => <div key={inv.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 p-3"><div><p className="text-sm font-medium text-slate-900">{inv.invoiceNumber}</p><p className="text-xs text-slate-500">{inv.client.name}</p></div><div className="text-right"><p className="text-sm font-medium text-slate-900">{formatCurrency(inv.total)}</p><StatusBadge status={inv.status} /></div></div>)}</div>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Recent Expenses</CardTitle></CardHeader><CardContent>
        {data.recentExpenses.length === 0 ? <p className="text-sm text-slate-500">No expenses yet</p> : <div className="space-y-2">{data.recentExpenses.map(exp => <div key={exp.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3"><div className="min-w-0"><p className="break-words text-sm font-medium text-slate-900">{exp.description}</p><p className="mt-1 text-xs text-slate-500">{formatDate(exp.date)} · {exp.category.name}</p></div><p className="shrink-0 text-sm font-medium tabular-nums text-slate-900">{formatCurrency(exp.grossAmount)}</p></div>)}</div>}
      </CardContent></Card>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Upcoming Due</CardTitle></CardHeader><CardContent>
        {data.upcomingDue.length === 0 ? <p className="text-sm text-slate-500">No upcoming invoices</p> : <div className="space-y-2">{data.upcomingDue.map(inv => <div key={inv.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 p-3"><div><p className="text-sm font-medium text-slate-900">{inv.invoiceNumber}</p><p className="text-xs text-slate-500">{inv.client.name} - Due {formatDate(inv.dueDate)}</p></div><p className="text-sm font-medium text-slate-900">{formatCurrency(inv.balanceDue)}</p></div>)}</div>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Overdue Alerts</CardTitle></CardHeader><CardContent>
        {data.overdueList.length === 0 ? <p className="text-sm text-slate-500">No overdue invoices</p> : <div className="space-y-2">{data.overdueList.map(inv => <div key={inv.id} className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-3"><div><p className="text-sm font-medium text-slate-900">{inv.invoiceNumber}</p><p className="text-xs text-slate-500">{inv.client.name} - Due {formatDate(inv.dueDate)}</p></div><p className="text-sm font-medium text-rose-700">{formatCurrency(inv.balanceDue)}</p></div>)}</div>}
      </CardContent></Card>
    </div>
    {writable && <div className="flex flex-wrap gap-2">
      <Link className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2" href="/invoices/new"><FileText aria-hidden="true" className="mr-2 h-4 w-4" />New Invoice</Link>
      <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white/90 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2" href="/clients/new"><Users aria-hidden="true" className="mr-2 h-4 w-4" />New Client</Link>
      <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white/90 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2" href="/expenses/new"><Receipt aria-hidden="true" className="mr-2 h-4 w-4" />New Expense</Link>
      <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white/90 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2" href="/bank-import"><ArrowRight aria-hidden="true" className="mr-2 h-4 w-4" />Import Bank</Link>
    </div>}
  </div>
}
