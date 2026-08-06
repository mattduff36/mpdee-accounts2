import {
  emailShell,
  emailSpacer,
  escapeHtml,
  FONT_BODY,
  FONT_BRAND,
  formatEmailCurrency,
  formatEmailDate,
  getPredominantBusinessAreaHex,
  summaryPanel,
} from "./shared"

export type PaymentReceivedEmailInput = {
  invoiceNumber: string
  total: number // pence — amount paid / invoice total for confirmation
  clientName: string
  paidAt?: Date | null
  items: { businessArea?: string | null }[]
}

export function renderPaymentReceivedEmail(input: PaymentReceivedEmailInput): {
  subject: string
  html: string
} {
  const amount = formatEmailCurrency(input.total / 100)
  const paidDate = formatEmailDate(input.paidAt || new Date())
  const accent = getPredominantBusinessAreaHex(input.items)
  const subject = `Payment Received - Thank You! (${input.invoiceNumber})`

  const children = `
    <h1 style="margin:0 0 8px;font-family:${FONT_BRAND};font-size:28px;line-height:1.2;font-weight:700;color:#0f172a;">Payment received</h1>
    <p style="margin:0 0 24px;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:#334155;">
      Dear ${escapeHtml(input.clientName)},
    </p>
    <p style="margin:0 0 24px;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:#334155;">
      Thank you for your payment. We are pleased to confirm that we have received your payment for invoice <strong style="color:#0f172a;">${escapeHtml(input.invoiceNumber)}</strong>.
    </p>
    ${summaryPanel(
      [
        { label: "Invoice number", value: input.invoiceNumber },
        { label: "Amount paid", value: amount, emphasize: true },
        { label: "Marked paid date", value: paidDate },
      ],
      accent
    )}
    ${emailSpacer(24)}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f8fafc" style="margin:0;border-left:3px solid ${accent};background-color:#f8fafc;">
      <tr>
        <td style="padding:14px 16px;font-family:${FONT_BODY};font-size:13px;line-height:1.55;color:#475569;">
          <strong style="color:#0f172a;">Need a receipt?</strong>
          This email serves as confirmation of payment. For formal receipts or any questions, please contact us.
        </td>
      </tr>
    </table>
    ${emailSpacer(28)}
    <p style="margin:0;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:#334155;">
      If you have any questions about this payment or need any additional documentation, please don't hesitate to contact us.
    </p>
  `

  return {
    subject,
    html: emailShell({
      accent,
      preheader: `Payment received for invoice ${input.invoiceNumber} (${amount})`,
      title: subject,
      children,
    }),
  }
}
