import { Resend } from "resend"
import { prisma } from "./db"
import { invoiceSendLockKey } from "./invoice-send-lock"
import { generateInvoicePDF } from "./pdf"
import { renderInvoiceEmail } from "@/emails/invoice-email"
import { renderPaymentReceivedEmail } from "@/emails/payment-received-email"

async function sendViaProvider(options: {
  to: string
  bcc?: string
  subject: string
  html: string
  attachments?: { filename: string; content: Buffer; contentType?: string }[]
}): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  const provider = process.env.EMAIL_PROVIDER || "mock"
  if (provider === "mock") {
    return { ok: true, providerId: `mock-${Date.now()}` }
  }
  if (provider !== "resend") {
    return { ok: false, error: `Unsupported EMAIL_PROVIDER: ${provider}` }
  }
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, error: "RESEND_API_KEY is required when EMAIL_PROVIDER=resend" }
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const emailData: Record<string, unknown> = {
    from: "MPDEE Admin <admin@mpdee.co.uk>",
    to: options.to,
    subject: options.subject,
    html: options.html,
  }
  if (options.bcc) emailData.bcc = options.bcc
  if (options.attachments?.length) {
    emailData.attachments = options.attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    }))
  }

  const result = await resend.emails.send(emailData as any)
  if (result.error) return { ok: false, error: result.error.message }
  return { ok: true, providerId: result.data?.id }
}

type Claim =
  | { kind: "error"; error: string }
  | { kind: "already_sent" }
  | { kind: "claimed"; pendingId: string; emailSubject: string }

export async function sendInvoiceEmail(invoiceId: string): Promise<{ ok: boolean; error?: string }> {
  const settings = await prisma.companySettings.findUnique({ where: { id: "default" } })
  const invoiceForSubject = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { client: true, items: true },
  })
  if (!invoiceForSubject) return { ok: false, error: "Invoice not found" }
  if (!invoiceForSubject.client.email) return { ok: false, error: "Client has no email address" }

  const preview = renderInvoiceEmail({
    invoiceNumber: invoiceForSubject.invoiceNumber,
    issueDate: invoiceForSubject.issueDate,
    dueDate: invoiceForSubject.dueDate,
    total: invoiceForSubject.total,
    clientName: invoiceForSubject.client.name,
    items: invoiceForSubject.items,
    businessName: settings?.businessName || process.env.COMPANY_NAME || "MPDEE",
    emailSubjectTemplate: settings?.emailSubjectTemplate,
    emailBodyTemplate: settings?.emailBodyTemplate,
  })

  const claim: Claim = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceSendLockKey(invoiceId)}))`

    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { client: true },
    })
    if (!invoice) return { kind: "error", error: "Invoice not found" }
    if (!invoice.client.email) return { kind: "error", error: "Client has no email address" }
    if (!["draft", "sent"].includes(invoice.status)) {
      return { kind: "error", error: `Cannot send invoice in status "${invoice.status}"` }
    }

    const emailSubject = preview.subject
    const pendingClaim = await tx.emailLog.findFirst({
      where: { invoiceId, status: "pending", subject: emailSubject },
      orderBy: { createdAt: "desc" },
    })
    if (pendingClaim) return { kind: "error", error: "Send already in progress" }

    const recentSent = await tx.emailLog.findFirst({
      where: {
        invoiceId,
        status: "sent",
        subject: emailSubject,
        createdAt: { gte: new Date(Date.now() - 30_000) },
      },
      orderBy: { createdAt: "desc" },
    })
    if (recentSent) return { kind: "already_sent" }

    const pending = await tx.emailLog.create({
      data: {
        invoiceId,
        toAddress: invoice.client.email,
        fromAddress: "MPDEE Admin <admin@mpdee.co.uk>",
        subject: emailSubject,
        status: "pending",
        provider: process.env.EMAIL_PROVIDER || "mock",
      },
    })
    return { kind: "claimed", pendingId: pending.id, emailSubject }
  })

  if (claim.kind === "error") return { ok: false, error: claim.error }
  if (claim.kind === "already_sent") return { ok: true }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { client: true, items: { orderBy: { sortOrder: "asc" } } },
  })
  if (!invoice?.client.email) {
    await prisma.emailLog.update({
      where: { id: claim.pendingId },
      data: { status: "failed", error: "Invoice missing during send" },
    })
    return { ok: false, error: "Invoice not found" }
  }

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
  const pdfBuffer = Buffer.from(pdfArrayBuffer)

  await prisma.emailLog.update({ where: { id: claim.pendingId }, data: { body: rendered.html } })

  const result = await sendViaProvider({
    to: invoice.client.email,
    bcc: "admin@mpdee.co.uk",
    subject: rendered.subject,
    html: rendered.html,
    attachments: [
      {
        filename: `invoice-${invoice.invoiceNumber}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  })

  if (!result.ok) {
    await prisma.emailLog.update({
      where: { id: claim.pendingId },
      data: { status: "failed", error: result.error || "Send failed" },
    })
    return { ok: false, error: result.error || "Failed to send invoice email" }
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invoiceSendLockKey(invoiceId)}))`
    await tx.emailLog.update({
      where: { id: claim.pendingId },
      data: {
        status: "sent",
        sentAt: new Date(),
        error: result.providerId ? `providerId=${result.providerId}` : null,
      },
    })
    await tx.invoice.updateMany({
      where: { id: invoiceId, status: { in: ["draft", "sent"] } },
      data: { status: "sent", sentAt: new Date() },
    })
  })

  return { ok: true }
}

export async function sendPaymentReceivedEmail(
  invoiceId: string,
  options?: { amountPaidPence?: number }
): Promise<{ ok: boolean; error?: string }> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { client: true, items: { orderBy: { sortOrder: "asc" } } },
  })
  if (!invoice) return { ok: false, error: "Invoice not found" }
  if (!invoice.client.email) return { ok: false, error: "Client has no email address" }

  const rendered = renderPaymentReceivedEmail({
    invoiceNumber: invoice.invoiceNumber,
    total: options?.amountPaidPence ?? invoice.total,
    clientName: invoice.client.name,
    paidAt: invoice.paidAt || new Date(),
    items: invoice.items,
  })

  const pending = await prisma.emailLog.create({
    data: {
      invoiceId,
      toAddress: invoice.client.email,
      fromAddress: "MPDEE Admin <admin@mpdee.co.uk>",
      subject: rendered.subject,
      body: rendered.html,
      status: "pending",
      provider: process.env.EMAIL_PROVIDER || "mock",
    },
  })

  const result = await sendViaProvider({
    to: invoice.client.email,
    bcc: "admin@mpdee.co.uk",
    subject: rendered.subject,
    html: rendered.html,
  })

  if (!result.ok) {
    await prisma.emailLog.update({
      where: { id: pending.id },
      data: { status: "failed", error: result.error || "Send failed" },
    })
    return { ok: false, error: result.error || "Failed to send payment email" }
  }

  await prisma.emailLog.update({
    where: { id: pending.id },
    data: {
      status: "sent",
      sentAt: new Date(),
      error: result.providerId ? `providerId=${result.providerId}` : null,
    },
  })

  return { ok: true }
}
