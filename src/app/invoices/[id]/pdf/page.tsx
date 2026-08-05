'use client'
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { formatCurrency } from "@/lib/format"

export default function InvoicePDFPage() {
  const params = useParams()
  const [invoice, setInvoice] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  useEffect(() => {
    fetch(`/api/invoices/${params.id}`).then(r => r.json()).then(setInvoice)
    fetch("/api/settings").then(r => r.json()).then(setCompany)
  }, [params.id])
  function generatePDF() {
    if (!invoice || !company) return
    const doc = new jsPDF()
    doc.setFontSize(20); doc.text(company.businessName || "My Business", 14, 20)
    doc.setFontSize(10)
    const addr = [company.addressLine1, company.addressLine2, company.city, company.county, company.postcode].filter(Boolean).join(", ")
    if (addr) doc.text(addr, 14, 28)
    if (company.email) doc.text(company.email, 14, 33)
    if (company.phone) doc.text(company.phone, 14, 38)
    doc.setFontSize(16); doc.text("INVOICE", 140, 20)
    doc.setFontSize(10)
    doc.text(`Invoice #: ${invoice.invoiceNumber}`, 140, 28)
    doc.text(`Issue Date: ${new Date(invoice.issueDate).toLocaleDateString("en-GB")}`, 140, 33)
    doc.text(`Due Date: ${new Date(invoice.dueDate).toLocaleDateString("en-GB")}`, 140, 38)
    doc.text("BILL TO:", 14, 55); doc.setFontSize(12)
    doc.text(invoice.client.name, 14, 62)
    doc.setFontSize(10)
    if (invoice.client.companyName) doc.text(invoice.client.companyName, 14, 67)
    const cAddr = [invoice.client.addressLine1, invoice.client.addressLine2, invoice.client.city, invoice.client.county, invoice.client.postcode].filter(Boolean).join(", ")
    if (cAddr) doc.text(cAddr, 14, invoice.client.companyName ? 72 : 67)
    const body = invoice.items.map((item: any) => [item.description, item.quantity, formatCurrency(item.unitPrice), `${item.vatRate}%`, formatCurrency(item.discount), formatCurrency(item.lineTotal)])
    autoTable(doc, { startY: 85, head: [["Description", "Qty", "Unit Price", "VAT", "Discount", "Total"]], body, theme: "grid", headStyles: { fillColor: [59, 130, 246] } })
    const finalY = (doc as any).lastAutoTable?.finalY || 120
    doc.setFontSize(10)
    doc.text(`Subtotal: ${formatCurrency(invoice.subtotal)}`, 140, finalY + 10)
    doc.text(`VAT: ${formatCurrency(invoice.vatTotal)}`, 140, finalY + 15)
    doc.text(`Discount: ${formatCurrency(invoice.discountTotal)}`, 140, finalY + 20)
    doc.setFontSize(12); doc.text(`Total: ${formatCurrency(invoice.total)}`, 140, finalY + 28)
    doc.setFontSize(10)
    if (invoice.amountPaid > 0) doc.text(`Amount Paid: ${formatCurrency(invoice.amountPaid)}`, 140, finalY + 35)
    if (invoice.balanceDue > 0) doc.text(`Balance Due: ${formatCurrency(invoice.balanceDue)}`, 140, finalY + 40)
    if (company.paymentInstructions) { doc.text("Payment Instructions:", 14, finalY + 50); doc.text(company.paymentInstructions, 14, finalY + 55) }
    if (company.bankAccountNumber) { doc.text(`Bank: ${company.bankName || ""} | Account: ${company.bankAccountNumber} | Sort Code: ${company.bankSortCode || ""}`, 14, finalY + 62) }
    if (invoice.notes) { doc.text("Notes:", 14, finalY + 70); doc.text(invoice.notes, 14, finalY + 75) }
    doc.save(`${invoice.invoiceNumber}.pdf`)
  }
  if (!invoice) return <div className="p-8 text-center">Loading...</div>
  return <div className="space-y-4"><h1 className="text-2xl font-bold">Invoice PDF</h1><Button onClick={generatePDF}>Download PDF</Button>
    <div className="rounded-lg border bg-white p-8 space-y-4">
      <div className="flex justify-between"><div><h2 className="text-xl font-bold">{company?.businessName || "My Business"}</h2>{company?.email && <p className="text-sm text-gray-500">{company.email}</p>}</div><div className="text-right"><h2 className="text-xl font-bold">INVOICE</h2><p className="text-sm text-gray-500">{invoice.invoiceNumber}</p></div></div>
      <div className="border-t pt-4"><p className="font-medium">Bill To: {invoice.client.name}</p><p className="text-sm text-gray-500">{invoice.client.companyName}</p></div>
      <table className="w-full text-sm border"><thead className="bg-gray-50"><tr><th className="px-4 py-2 text-left">Description</th><th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2 text-right">Price</th><th className="px-4 py-2 text-right">Total</th></tr></thead>
      <tbody>{invoice.items.map((item: any) => <tr key={item.id} className="border-t"><td className="px-4 py-2">{item.description}</td><td className="px-4 py-2 text-right">{item.quantity}</td><td className="px-4 py-2 text-right">{formatCurrency(item.unitPrice)}</td><td className="px-4 py-2 text-right">{formatCurrency(item.lineTotal)}</td></tr>)}</tbody></table>
      <div className="flex justify-end space-y-1 text-sm"><div className="text-right"><p>Subtotal: {formatCurrency(invoice.subtotal)}</p><p>VAT: {formatCurrency(invoice.vatTotal)}</p><p className="text-lg font-bold">Total: {formatCurrency(invoice.total)}</p></div></div>
    </div>
  </div>
}
