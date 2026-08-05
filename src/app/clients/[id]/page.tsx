import { prisma } from "@/lib/db"
import { formatCurrency, formatDate } from "@/lib/format"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/StatusBadge"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import Link from "next/link"
import { notFound } from "next/navigation"
import { FileText, Mail, Phone, MapPin } from "lucide-react"

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const client = await prisma.client.findUnique({ where: { id }, include: { invoices: { orderBy: { createdAt: "desc" } }, payments: { orderBy: { date: "desc" } } } })
  if (!client) notFound()
  const totalInvoiced = client.invoices.reduce((s, i) => s + i.total, 0)
  const totalPaid = client.invoices.reduce((s, i) => s + i.amountPaid, 0)
  const outstanding = client.invoices.filter(i => ["sent", "viewed", "partial", "overdue"].includes(i.status)).reduce((s, i) => s + i.balanceDue, 0)
  return <div className="space-y-6">
    <PageHeader title={client.name} description={client.companyName || undefined}>
      <Link href={`/clients/${id}/edit`}><Button variant="secondary">Edit Client</Button></Link>
    </PageHeader>
    <div className="grid gap-4 md:grid-cols-3">
      <Card><CardContent className="pt-6"><p className="text-sm text-gray-500">Total Invoiced</p><p className="text-2xl font-bold">{formatCurrency(totalInvoiced)}</p></CardContent></Card>
      <Card><CardContent className="pt-6"><p className="text-sm text-gray-500">Total Paid</p><p className="text-2xl font-bold text-green-600">{formatCurrency(totalPaid)}</p></CardContent></Card>
      <Card><CardContent className="pt-6"><p className="text-sm text-gray-500">Outstanding</p><p className="text-2xl font-bold text-red-600">{formatCurrency(outstanding)}</p></CardContent></Card>
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Contact Information</CardTitle></CardHeader><CardContent className="space-y-2">
        {client.email && <div className="flex items-center gap-2 text-sm"><Mail className="h-4 w-4 text-gray-400" />{client.email}</div>}
        {client.phone && <div className="flex items-center gap-2 text-sm"><Phone className="h-4 w-4 text-gray-400" />{client.phone}</div>}
        {(client.addressLine1 || client.city) && <div className="flex items-start gap-2 text-sm"><MapPin className="h-4 w-4 text-gray-400 mt-0.5" /><span>{[client.addressLine1, client.addressLine2, client.city, client.county, client.postcode].filter(Boolean).join(", ")}</span></div>}
        {client.vatNumber && <p className="text-sm text-gray-500">VAT: {client.vatNumber}</p>}
        {client.notes && <p className="text-sm text-gray-500 mt-2">{client.notes}</p>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Invoices</CardTitle></CardHeader><CardContent>
        {client.invoices.length === 0 ? <p className="text-sm text-gray-500">No invoices</p> : <div className="space-y-2">{client.invoices.map(inv => <div key={inv.id} className="flex items-center justify-between rounded-md border p-3"><div><p className="text-sm font-medium">{inv.invoiceNumber}</p><p className="text-xs text-gray-500">{formatDate(inv.issueDate)}</p></div><div className="text-right"><p className="text-sm font-medium">{formatCurrency(inv.total)}</p><StatusBadge status={inv.status} /></div></div>)}</div>}
      </CardContent></Card>
    </div>
  </div>
}
