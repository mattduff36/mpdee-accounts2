/** Exact PDF invoice brand colours (src/lib/pdf.ts) — email header must match. */
export const BUSINESS_AREA_COLORS = {
  CREATIVE: "#074EBC", // Creative — deep blue
  DEVELOPMENT: "#FBB711", // Development — gold
  SUPPORT: "#C83135", // Support — red
} as const

export type BusinessAreaKey = keyof typeof BUSINESS_AREA_COLORS

/**
 * Logo wordmark: bold geometric sans (matches MPDEE mark).
 * Email-safe stack — no webfonts required.
 */
export const FONT_BRAND =
  "Helvetica Neue, Helvetica, Arial, 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif"
export const FONT_BODY =
  "Helvetica Neue, Helvetica, Arial, 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif"

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function formatEmailCurrency(amountPounds: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(amountPounds)
}

export function formatEmailDate(date: Date | string | null | undefined): string {
  if (!date) return "—"
  const d = typeof date === "string" ? new Date(date) : date
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })
}

export function getPredominantBusinessAreaHex(
  items: { businessArea?: string | null }[]
): string {
  if (items.length === 0) return BUSINESS_AREA_COLORS.CREATIVE
  const counts = items.reduce((acc, item) => {
    const area = (item.businessArea || "CREATIVE").toUpperCase()
    acc[area] = (acc[area] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  let max = 0
  let predominant = (items[0].businessArea || "CREATIVE").toUpperCase()
  for (const [area, count] of Object.entries(counts)) {
    if (count > max) {
      max = count
      predominant = area
    }
  }
  const ties = Object.values(counts).filter((c) => c === max).length
  if (ties > 1) predominant = (items[0].businessArea || "CREATIVE").toUpperCase()
  return BUSINESS_AREA_COLORS[predominant as BusinessAreaKey] || BUSINESS_AREA_COLORS.CREATIVE
}

/** Header text colour: black on Development gold (brand pills), white on blue/red. */
export function accentTextColor(accentHex: string): string {
  return accentHex.toUpperCase() === BUSINESS_AREA_COLORS.DEVELOPMENT.toUpperCase()
    ? "#000000"
    : "#ffffff"
}

export function interpolateTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return vars[key] ?? ""
  })
}

/** Convert plain-text / template body into escaped HTML paragraphs. */
export function bodyTemplateToHtml(body: string): string {
  const trimmed = body.trim()
  if (!trimmed) return ""
  return trimmed
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").map((line) => escapeHtml(line)).join("<br>")
      return `<p style="margin:0 0 16px;font-family:${FONT_BODY};font-size:15px;line-height:1.6;color:#334155;">${lines}</p>`
    })
    .join("")
}

export function emailShell(options: {
  accent: string
  preheader: string
  title: string
  children: string
}): string {
  const textOnAccent = accentTextColor(options.accent)
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(options.title)}</title>
<style type="text/css">
  :root { color-scheme: light only; supported-color-schemes: light only; }
  u + .body { background-color: #f1f5f9 !important; }
</style>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body class="body" style="margin:0;padding:0;background-color:#f1f5f9;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(options.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f1f5f9" style="background-color:#f1f5f9;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;">
        <tr>
          <td bgcolor="${options.accent}" style="background-color:${options.accent};background:${options.accent};background-image:linear-gradient(${options.accent},${options.accent});padding:26px 32px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="font-family:${FONT_BRAND};font-size:28px;font-weight:800;letter-spacing:0.04em;text-transform:none;color:${textOnAccent};line-height:1;">
                  <!--[if mso]><span style="font-family:Arial,sans-serif;font-weight:800;"><![endif]-->MPDEE Group<!--[if mso]></span><![endif]-->
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td bgcolor="#ffffff" style="padding:36px 32px 28px;background-color:#ffffff;">
            ${options.children}
          </td>
        </tr>
        <tr>
          <td bgcolor="#ffffff" style="padding:0 32px 32px;background-color:#ffffff;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-top:1px solid #e2e8f0;">
              <tr>
                <td style="padding-top:20px;font-family:${FONT_BODY};font-size:13px;line-height:1.5;color:#64748b;">
                  Kind regards,<br>
                  <strong style="color:#0f172a;">MPDEE Admin</strong><br>
                  <a href="https://mpdee.co.uk" style="color:${options.accent};text-decoration:none;">mpdee.co.uk</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
        <tr>
          <td align="center" style="padding:20px 16px 0;font-family:${FONT_BODY};font-size:11px;line-height:1.4;color:#94a3b8;">
            Matthew Duffill trading as MPDEE Group · United Kingdom
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

/** Explicit spacer — email clients collapse CSS margins between tables/paragraphs. */
export function emailSpacer(heightPx = 28): string {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td height="${heightPx}" style="height:${heightPx}px;line-height:${heightPx}px;font-size:${heightPx}px;mso-line-height-rule:exactly;">&nbsp;</td>
      </tr>
    </table>`
}

export function summaryPanel(rows: Array<{ label: string; value: string; emphasize?: boolean }>, accent: string): string {
  const rowHtml = rows
    .map(
      (row, i) => `
      <tr>
        <td style="padding:10px 0;${i < rows.length - 1 ? "border-bottom:1px solid #e2e8f0;" : ""}font-family:${FONT_BODY};font-size:13px;color:#64748b;width:40%;">${escapeHtml(row.label)}</td>
        <td style="padding:10px 0;${i < rows.length - 1 ? "border-bottom:1px solid #e2e8f0;" : ""}font-family:${FONT_BODY};font-size:14px;color:${row.emphasize ? accent : "#0f172a"};font-weight:${row.emphasize ? "700" : "600"};text-align:right;">${escapeHtml(row.value)}</td>
      </tr>`
    )
    .join("")
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f8fafc" style="background-color:#f8fafc;border:1px solid #e2e8f0;margin:0;">
      <tr>
        <td style="padding:4px 20px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            ${rowHtml}
          </table>
        </td>
      </tr>
    </table>`
}
