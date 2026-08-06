/**
 * Preview emails via Resend to admin@mpdee.co.uk ONLY (never the client).
 *
 * Usage:
 *   npx tsx scripts/send-test-invoice.ts invoice MPD-2026-043
 *   npx tsx scripts/send-test-invoice.ts payment MPD-2026-043
 */
import { Resend } from "resend"
import { PrismaClient } from "@prisma/client"
import { generateInvoicePDF } from "../src/lib/pdf"
import { renderInvoiceEmail } from "../src/emails/invoice-email"
import { renderPaymentReceivedEmail } from "../src/emails/payment-received-email"
import { getPredominantBusinessAreaHex } from "../src/emails/shared"
import { loadLocalEnv } from "./load-env"

loadLocalEnv()

const TO = "admin@mpdee.co.uk"
const mode = (process.argv[2] || "invoice") as "invoice" | "payment"
const invoiceNumber = process.argv[3] || "MPD-2026-043"

async function main() {
  if (process.env.EMAIL_PROVIDER !== "resend") {
    throw new Error(`EMAIL_PROVIDER must be resend (got ${process.env.EMAIL_PROVIDER})`)
  }
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY missing")
  if (TO !== "admin@mpdee.co.uk") throw new Error("Refusing send: TO must be admin@mpdee.co.uk")
  if (mode !== "invoice" && mode !== "payment") {
    throw new Error('Mode must be "invoice" or "payment"')
  }

  const prisma = new PrismaClient()
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { invoiceNumber },
      include: { client: true, items: { orderBy: { sortOrder: "asc" } } },
    })
    if (!invoice) throw new Error(`Invoice ${invoiceNumber} not found`)
    const settings = await prisma.companySettings.findUnique({ where: { id: "default" } })

    let subject = ""
    let html = ""
    const attachments: { filename: string; content: Buffer }[] = []

    if (mode === "invoice") {
      const rendered = renderInvoiceEmail({
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        total: invoice.total,
        clientName: invoice.client.name,
        items: invoice.items,
        businessName: settings?.businessName || process.env.COMPANY_NAME || "MPDEE",
        emailSubjectTemplate: settings?.emailSubjectTemplate,
        emailBodyTemplate: settings?.emailBodyTemplate,
      })
      subject = rendered.subject
      html = rendered.html.replace(
        "</body>",
        `<div style="display:none"></div><!-- preview banner injected below --></body>`
      )
      // Inject visible preview notice at top of body content
      html = html.replace(
        '<td style="padding:36px 32px 28px;">',
        `<td style="padding:36px 32px 28px;"><p style="margin:0 0 20px;padding:12px 14px;background:#f1f5f9;border:1px solid #cbd5e1;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:13px;color:#334155;"><strong>TEST PREVIEW</strong> — sent only to ${TO}. Client (${invoice.client.email || "no email"}) was not emailed.</p>`
      )

      const pdf = await generateInvoicePDF({
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
      attachments.push({
        filename: `invoice-${invoice.invoiceNumber}.pdf`,
        content: Buffer.from(pdf),
      })
    } else {
      const rendered = renderPaymentReceivedEmail({
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        clientName: invoice.client.name,
        paidAt: invoice.paidAt || new Date(),
        items: invoice.items,
      })
      subject = rendered.subject
      html = rendered.html.replace(
        '<td style="padding:36px 32px 28px;">',
        `<td style="padding:36px 32px 28px;"><p style="margin:0 0 20px;padding:12px 14px;background:#f1f5f9;border:1px solid #cbd5e1;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:13px;color:#334155;"><strong>TEST PREVIEW</strong> — payment-received template sent only to ${TO}. Client was not emailed.</p>`
      )
    }

    const resend = new Resend(process.env.RESEND_API_KEY)
    const result = await resend.emails.send({
      from: "MPDEE Admin <admin@mpdee.co.uk>",
      to: TO,
      subject: `[PREVIEW] ${subject}`,
      html,
      attachments,
    })

    if (result.error) {
      console.error("SEND_FAILED:", result.error.message)
      process.exit(1)
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode,
          to: TO,
          invoice: invoice.invoiceNumber,
          accent: getPredominantBusinessAreaHex(invoice.items),
          clientNotEmailed: invoice.client.email,
          subject: `[PREVIEW] ${subject}`,
          providerId: result.data?.id,
        },
        null,
        2
      )
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
