import { prisma } from "@/lib/db"
import { formatCurrency, formatDate, startOfMonth, endOfMonth, startOfYear } from "@/lib/format"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { StatusBadge } from "@/components/StatusBadge"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/PageHeader"
import Link from "next/link"
import { TrendingUp, TrendingDown, AlertTriangle, FileText, Users, Receipt, ArrowRight } from "lucide-react"

async function getDashboardData() {
  const now = new Date()
  const yearStart = startOfYear(now)
  const monthStart = startOfMonth(now)
  const monthEnd = endOfMonth(now)

  const paidInvoices = await prisma.invoice.aggregate({ _sum: { total: true }, where: { status: "paid", paidAt: { gte: yearStart } } })
  const unpaidInvoices = await prisma.invoice.aggregate({ _sum: { balanceDue: true }, where: { status: { in: ["sent", "viewed", "partial"] } } })
  const overdueInvoices = await prisma.invoice.aggregate({ _sum: { balanceDue: true }, where: { status: { in: ["overdue"] } } })
  const expensesThisMonth = await prisma.expense.aggregate({ _sum: { grossAmount: true }, where: { date: { gte: monthStart, lte: monthEnd } } })
  const recentInvoices = await prisma.invoice.findMany({ take: 5, orderBy: { createdAt: "desc" }, include: { client: { select: { name: true } } } })
  const recentExpenses = await prisma.expense.findMany({ take: 5, orderBy: { createdAt: "desc" }, include: { category: { select: { name: true } } } })
  const upcomingDue = await prisma.invoice.findMany({ where: { status: { in: ["sent", "viewed", "partial"] }, dueDate: { gte: now } }, take: 5, orderBy: { dueDate: "asc" }, include: { client: { select: { name: true } } } })
  const overdue = await prisma.invoice.findMany({ where: { status: { in: ["sent", "viewed", "partial", "overdue"] }, dueDate: { lt: now } }, take: 5, orderBy: { dueDate: "asc" }, include: { client: { select: { name: true } } } })
  const clientCount = await prisma.client.count({ where: { isArchived: false } })

  return {
    revenue: paidInvoices._sum.total || 0,
    unpaid: unpaidInvoices._sum.balanceDue || 0,
    overdueTotal: overdueInvoices._sum.balanceDue || 0,
    expenses: expensesThisMonth._sum.grossAmount || 0,
    profit: (paidInvoices._sum.total || 0) - (expensesThisMonth._sum.grossAmount || 0),
    clientCount,
    recentInvoices,
    recentExpenses,
    upcomingDue,
    overdueList: overdue,
  }
}

const metricStyles = {
  emerald: { icon: 'bg-emerald-50 text-emerald-600 ring-emerald-600/10', value: 'text-emerald-700' },
  blue: { icon: 'bg-blue-50 text-blue-600 ring-blue-600/10', value: 'text-slate-950' },
  rose: { icon: 'bg-rose-50 text-rose-600 ring-rose-600/10', value: 'text-rose-700' },
  slate: { icon: 'bg-slate-100 text-slate-600 ring-slate-600/10', value: 'text-slate-950' },
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
    <Card className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-sky-400 to-transparent" />
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-semibold text-slate-500">{title}</CardTitle>
        <div className={`rounded-xl p-2 ring-1 ring-inset ${styles.icon}`}>
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold tracking-tight ${styles.value}`}>{value}</div>
      </CardContent>
    </Card>
  )
}

export default async function DashboardPage() {
  const data = await getDashboardData()
  return <div className="space-y-6">
    <PageHeader title="Dashboard" description="Track cashflow, open invoices, and the next accounting actions at a glance." />
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <MetricCard title="Revenue (YTD)" value={formatCurrency(data.revenue)} icon={TrendingUp} tone="emerald" />
      <MetricCard title="Unpaid" value={formatCurrency(data.unpaid)} icon={Receipt} tone="blue" />
      <MetricCard title="Overdue" value={formatCurrency(data.overdueTotal)} icon={AlertTriangle} tone="rose" />
      <MetricCard title="Profit (MTD)" value={formatCurrency(data.profit)} icon={TrendingDown} tone={data.profit >= 0 ? 'emerald' : 'rose'} />
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Recent Invoices</CardTitle></CardHeader><CardContent>
        {data.recentInvoices.length === 0 ? <p className="text-sm text-slate-500">No invoices yet</p> : <div className="space-y-2">{data.recentInvoices.map(inv => <div key={inv.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 p-3"><div><p className="text-sm font-medium text-slate-900">{inv.invoiceNumber}</p><p className="text-xs text-slate-500">{inv.client.name}</p></div><div className="text-right"><p className="text-sm font-medium text-slate-900">{formatCurrency(inv.total)}</p><StatusBadge status={inv.status} /></div></div>)}</div>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Recent Expenses</CardTitle></CardHeader><CardContent>
        {data.recentExpenses.length === 0 ? <p className="text-sm text-slate-500">No expenses yet</p> : <div className="space-y-2">{data.recentExpenses.map(exp => <div key={exp.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 p-3"><div><p className="text-sm font-medium text-slate-900">{exp.description}</p><p className="text-xs text-slate-500">{exp.category.name}</p></div><p className="text-sm font-medium text-slate-900">{formatCurrency(exp.grossAmount)}</p></div>)}</div>}
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
    <div className="flex flex-wrap gap-2">
      <Link href="/invoices/new"><Button><FileText className="mr-2 h-4 w-4" />New Invoice</Button></Link>
      <Link href="/clients/new"><Button variant="secondary"><Users className="mr-2 h-4 w-4" />New Client</Button></Link>
      <Link href="/expenses/new"><Button variant="secondary"><Receipt className="mr-2 h-4 w-4" />New Expense</Button></Link>
      <Link href="/bank-import"><Button variant="secondary"><ArrowRight className="mr-2 h-4 w-4" />Import Bank</Button></Link>
    </div>
  </div>
}
