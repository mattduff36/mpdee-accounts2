import { NextRequest, NextResponse } from "next/server"
import { requireApiAuth } from "@/lib/auth"
import { generateInvoicePDF } from "@/lib/pdf"
import { prisma } from "@/lib/db"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiAuth()
    const { id } = await params
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { client: true, items: { orderBy: { sortOrder: "asc" } } },
    })
    if (!invoice) {
      return NextResponse.json({ success: false, error: "Invoice not found" }, { status: 404 })
    }

    const settings = await prisma.companySettings.findUnique({ where: { id: "default" } })
    const pdfArrayBuffer = await generateInvoicePDF({
      invoice: {
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        status: invoice.status,
        total: invoice.total,
        client: invoice.client,
        items: invoice.items,
      },
      company: {
        businessName: settings?.businessName || process.env.COMPANY_NAME || "MPDEE",
        addressLine1: settings?.addressLine1 || process.env.COMPANY_ADDRESS,
        bankAccountName: settings?.bankAccountName,
        bankSortCode: settings?.bankSortCode,
        bankAccountNumber: settings?.bankAccountNumber,
        bankName: settings?.bankName,
        paymentInstructions: settings?.paymentInstructions,
      },
    })

    return new NextResponse(pdfArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`,
        "Content-Length": String(pdfArrayBuffer.byteLength),
        "Cache-Control": "no-cache",
      },
    })
  } catch (error: any) {
    if (error.message === "Authentication required") {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 })
    }
    return NextResponse.json(
      { success: false, error: "Failed to generate PDF", details: error.message },
      { status: 500 }
    )
  }
}
