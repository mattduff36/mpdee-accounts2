import {
  bodyTemplateToHtml,
  emailShell,
  emailSpacer,
  escapeHtml,
  FONT_BODY,
  FONT_BRAND,
  formatEmailCurrency,
  formatEmailDate,
  getPredominantBusinessAreaHex,
  interpolateTemplate,
  summaryPanel,
} from "./shared"

export type InvoiceEmailItem = {
  description: string
  quantity: number
  unitPrice: number // pence
  lineTotal: number // pence
  businessArea?: string | null
}

export type InvoiceEmailInput = {
  invoiceNumber: string
  issueDate: Date
  dueDate: Date | null
  total: number // pence
  clientName: string
  items: InvoiceEmailItem[]
  businessName?: string | null
  emailSubjectTemplate?: string | null
  emailBodyTemplate?: string | null
}

const DEFAULT_SUBJECT = "Invoice {{invoiceNumber}} from {{businessName}}"
const DEFAULT_BODY = `Dear {{clientName}},

Thank you for your business! Please find your invoice attached to this email.

If you have any questions about this invoice, please don't hesitate to contact us.`

export function renderInvoiceEmail(input: InvoiceEmailInput): { subject: string; html: string } {
  const businessName = input.businessName || process.env.COMPANY_NAME || "MPDEE"
  const amount = formatEmailCurrency(input.total / 100)
  const dueDate = formatEmailDate(input.dueDate)
  const issueDate = formatEmailDate(input.issueDate)
  const vars = {
    invoiceNumber: input.invoiceNumber,
    businessName,
    clientName: input.clientName,
    amount,
    dueDate,
    issueDate,
  }

  const subject = interpolateTemplate(input.emailSubjectTemplate?.trim() || DEFAULT_SUBJECT, vars)
  const bodySource = input.emailBodyTemplate?.trim() || DEFAULT_BODY
  const bodyHtml = bodyTemplateToHtml(interpolateTemplate(bodySource, vars))
  const accent = getPredominantBusinessAreaHex(input.items)

  const services =
    input.items.length === 0
      ? ""
      : `
    ${emailSpacer(28)}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
      <tr>
        <td style="padding:0 0 12px;font-family:${FONT_BODY};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#475569;font-weight:700;line-height:1.4;">Services</td>
      </tr>
      ${input.items
        .map(
          (item, i) => `
        <tr>
          <td style="padding:12px 0;${i < input.items.length - 1 ? "border-bottom:1px solid #e2e8f0;" : ""}">
            <div style="font-family:${FONT_BODY};font-size:14px;font-weight:600;color:#0f172a;margin:0 0 4px;">${escapeHtml(item.description)}</div>
            <div style="font-family:${FONT_BODY};font-size:13px;color:#64748b;">${escapeHtml(String(item.quantity))} × ${escapeHtml(formatEmailCurrency(item.unitPrice / 100))} = <strong style="color:#0f172a;">${escapeHtml(formatEmailCurrency(item.lineTotal / 100))}</strong></div>
          </td>
        </tr>`
        )
        .join("")}
    </table>`

  const children = `
    <h1 style="margin:0 0 8px;font-family:${FONT_BRAND};font-size:28px;line-height:1.2;font-weight:700;color:#0f172a;">Invoice ${escapeHtml(input.invoiceNumber)}</h1>
    <p style="margin:0 0 28px;font-family:${FONT_BODY};font-size:14px;color:#64748b;">Prepared for ${escapeHtml(input.clientName)}</p>
    ${bodyHtml}
    ${summaryPanel(
      [
        { label: "Invoice number", value: input.invoiceNumber },
        { label: "Issue date", value: issueDate },
        ...(input.dueDate ? [{ label: "Due date", value: dueDate }] : []),
        { label: "Amount due", value: amount, emphasize: true },
      ],
      accent
    )}
    ${services}
    ${emailSpacer(8)}
    <p style="margin:0;font-family:${FONT_BODY};font-size:13px;line-height:1.5;color:#64748b;">A PDF copy of this invoice is attached for your records.</p>
  `

  return {
    subject,
    html: emailShell({
      accent,
      preheader: `Invoice ${input.invoiceNumber} for ${amount} from ${businessName}`,
      title: subject,
      children,
    }),
  }
}
