import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { PageHeader } from "@/components/PageHeader"
import Link from "next/link"
import { TrendingUp, BarChart3, PieChart, AlertTriangle, FileText, Users } from "lucide-react"

const reports = [
  { href: "/reports/profit-loss", title: "Profit & Loss", description: "Revenue, expenses and net profit summary", icon: TrendingUp },
  { href: "/reports/sales", title: "Sales by Month", description: "Monthly invoicing and payment trends", icon: BarChart3 },
  { href: "/reports/expenses", title: "Expenses by Category", description: "Breakdown of spending by category", icon: PieChart },
  { href: "/reports/debtors", title: "Aged Debtors", description: "Outstanding invoices by age buckets", icon: AlertTriangle },
  { href: "/reports/vat", title: "VAT Summary", description: "Output tax, input tax and net VAT due", icon: FileText },
  { href: "/reports/clients", title: "Client Revenue", description: "Revenue breakdown by client", icon: Users },
]

export default function ReportsPage() {
  return <div className="space-y-6">
    <PageHeader title="Reports" description="Analyse sales, costs, VAT, and debtor trends from one reporting hub." />
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {reports.map(r => <Link key={r.href} href={r.href}><Card className="h-full cursor-pointer transition duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_24px_70px_-36px_rgba(37,99,235,0.55)]">
        <CardHeader><div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-600/10"><r.icon className="h-6 w-6" /></div><CardTitle>{r.title}</CardTitle><CardDescription>{r.description}</CardDescription></CardHeader>
      </Card></Link>)}
    </div>
  </div>
}
