import { jsPDF } from "jspdf"
import fs from "fs"
import path from "path"

export type PdfInvoiceItem = {
  description: string
  quantity: number
  unitPrice: number // pence
  lineTotal: number // pence
  agencyCommission?: number | null
  businessArea?: string | null
}

export type PdfInvoice = {
  invoiceNumber: string
  issueDate: Date
  dueDate: Date | null
  status: string
  total: number // pence
  client: {
    name: string
    addressLine1?: string | null
    addressLine2?: string | null
    city?: string | null
    county?: string | null
    postcode?: string | null
  }
  items: PdfInvoiceItem[]
}

export type PdfCompany = {
  businessName: string
  addressLine1?: string | null
  bankAccountName?: string | null
  bankSortCode?: string | null
  bankAccountNumber?: string | null
  bankName?: string | null
  paymentInstructions?: string | null
}

function poundsFromPence(pence: number): number {
  return pence / 100
}

export function formatPdfCurrency(amountPounds: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(amountPounds)
}

export function formatPdfDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })
}

function getPredominantBusinessAreaColor(items: PdfInvoiceItem[]): readonly [number, number, number] {
  const businessAreaColors = {
    CREATIVE: [7, 78, 188] as const,
    DEVELOPMENT: [251, 183, 17] as const,
    SUPPORT: [200, 49, 53] as const,
  } as const

  if (items.length === 0) return businessAreaColors.CREATIVE

  const areaCounts = items.reduce((counts, item) => {
    const area = (item.businessArea || "CREATIVE").toUpperCase()
    counts[area] = (counts[area] || 0) + 1
    return counts
  }, {} as Record<string, number>)

  let maxCount = 0
  let predominantArea = (items[0].businessArea || "CREATIVE").toUpperCase()
  for (const [area, count] of Object.entries(areaCounts)) {
    if (count > maxCount) {
      maxCount = count
      predominantArea = area
    }
  }
  const tieCount = Object.values(areaCounts).filter((count) => count === maxCount).length
  if (tieCount > 1) predominantArea = (items[0].businessArea || "CREATIVE").toUpperCase()

  return businessAreaColors[predominantArea as keyof typeof businessAreaColors] || businessAreaColors.CREATIVE
}

function clientBillingAddress(client: PdfInvoice["client"]): string {
  return [client.addressLine1, client.addressLine2, client.city, client.county, client.postcode]
    .filter(Boolean)
    .join("\n")
}

export async function generateInvoicePDF(data: {
  invoice: PdfInvoice
  company: PdfCompany
}): Promise<ArrayBuffer> {
  const { invoice, company } = data
  const doc = new jsPDF()
  const brandColor = getPredominantBusinessAreaColor(invoice.items)
  const blackColor = [0, 0, 0] as const
  const grayColor = [107, 114, 128] as const
  const pageHeight = 297
  const bottomMargin = 20
  const maxYPos = pageHeight - bottomMargin

  let logoBase64: string | null = null
  try {
    const logoPath = path.join(process.cwd(), "public", "images", "Invoice-logo-new.png")
    if (fs.existsSync(logoPath)) {
      logoBase64 = `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`
    }
  } catch {
    // logo optional
  }

  const companyName = company.businessName || "MPDEE"
  const companyAddress =
    company.addressLine1 || "6 Brocklehurst Drive, Edwinstowe, Mansfield, Notts. NG21 9JW"
  const beneficiary = company.bankAccountName || "Matthew Duffill trading as MPDEE Group"
  const sortCode = company.bankSortCode || "04-00-05"
  const accountNumber = company.bankAccountNumber || "88760521"

  const drawContinuationHeader = () => {
    const headerY = 15
    if (logoBase64) {
      doc.addImage(logoBase64, "PNG", 20, headerY, 40, 0)
    } else {
      doc.setFontSize(14)
      doc.setTextColor(...brandColor)
      doc.text(companyName, 20, headerY)
    }
    doc.setFontSize(11)
    doc.setTextColor(...grayColor)
    doc.text(`Invoice: ${invoice.invoiceNumber}`, 190, headerY + 5, { align: "right" })
    doc.setDrawColor(...brandColor)
    doc.setLineWidth(0.5)
    doc.line(20, headerY + 12, 190, headerY + 12)
    return headerY + 20
  }

  const drawTableHeader = (yPosition: number) => {
    doc.setFillColor(...brandColor)
    doc.rect(20, yPosition, 170, 10, "F")
    doc.setFontSize(10)
    doc.setTextColor(255, 255, 255)
    doc.text("Description", 25, yPosition + 6.5)
    doc.text("Qty", 125, yPosition + 6.5, { align: "center" })
    doc.text("Rate", 150, yPosition + 6.5, { align: "center" })
    doc.text("Amount", 185, yPosition + 6.5, { align: "right" })
    return yPosition + 10
  }

  let yPos = 25
  let logoHeight = 0
  if (logoBase64) {
    doc.addImage(logoBase64, "PNG", 20, yPos, 60, 0)
    logoHeight = 25
  } else {
    doc.setFontSize(20)
    doc.setTextColor(...brandColor)
    doc.text(companyName, 20, yPos)
    logoHeight = 15
  }

  doc.setFontSize(28)
  doc.setTextColor(...brandColor)
  doc.text("INVOICE", 190, yPos + 5, { align: "right" })
  doc.setFontSize(16)
  doc.setTextColor(...blackColor)
  doc.text(`${invoice.invoiceNumber}`, 190, yPos + 15, { align: "right" })
  doc.setFontSize(11)
  doc.setTextColor(...grayColor)
  doc.text(`Date: ${formatPdfDate(invoice.issueDate)}`, 190, yPos + 25, { align: "right" })
  if (invoice.dueDate) {
    doc.text(`Due: ${formatPdfDate(invoice.dueDate)}`, 190, yPos + 32, { align: "right" })
  }

  yPos += logoHeight + 10
  doc.setFontSize(9)
  doc.setTextColor(...grayColor)
  doc.text(companyAddress, 20, yPos)
  yPos += 12
  doc.setDrawColor(...brandColor)
  doc.setLineWidth(0.8)
  doc.line(20, yPos, 190, yPos)
  yPos += 12

  doc.setFontSize(13)
  doc.setTextColor(...brandColor)
  doc.text("BILL TO:", 20, yPos)
  yPos += 10
  doc.setFontSize(12)
  doc.setTextColor(...blackColor)
  doc.text(invoice.client.name, 20, yPos)
  yPos += 6

  const billing = clientBillingAddress(invoice.client)
  if (billing) {
    doc.setFontSize(10)
    doc.setTextColor(...grayColor)
    billing.split("\n").forEach((line) => {
      doc.text(line, 20, yPos)
      yPos += 4
    })
  }
  yPos += 8
  yPos = drawTableHeader(yPos)

  const baseRowHeight = 8
  const maxDescriptionWidth = 95
  invoice.items.forEach((item, index) => {
    let fullDescription = item.description
    if (item.agencyCommission && item.agencyCommission > 0) {
      const commissionPercent =
        item.agencyCommission % 1 === 0
          ? item.agencyCommission.toString()
          : item.agencyCommission.toFixed(1)
      fullDescription += `\n- minus ${commissionPercent}% Agency Commission`
    }

    doc.setFontSize(10)
    const descriptionLines = doc.splitTextToSize(fullDescription, maxDescriptionWidth)
    const actualRowHeight = Math.max(baseRowHeight, descriptionLines.length * 4 + 4)

    if (yPos + actualRowHeight > maxYPos - 50) {
      doc.addPage()
      yPos = drawContinuationHeader()
      yPos = drawTableHeader(yPos)
    }

    if (index % 2 === 1) {
      doc.setFillColor(248, 250, 252)
      doc.rect(20, yPos, 170, actualRowHeight, "F")
    }

    doc.setTextColor(...blackColor)
    descriptionLines.forEach((line: string, lineIndex: number) => {
      if (lineIndex === 0) {
        doc.text(line, 25, yPos + 5.5)
      } else if (line.includes("minus") && line.includes("Agency Commission")) {
        doc.setTextColor(...grayColor)
        doc.text(line, 25, yPos + 5.5 + lineIndex * 4)
        doc.setTextColor(...blackColor)
      } else {
        doc.text(line, 25, yPos + 5.5 + lineIndex * 4)
      }
    })

    const centerY = yPos + actualRowHeight / 2 + 1
    doc.text(item.quantity.toString(), 125, centerY, { align: "center" })
    doc.text(formatPdfCurrency(poundsFromPence(item.unitPrice)), 150, centerY, { align: "center" })
    doc.text(formatPdfCurrency(poundsFromPence(item.lineTotal)), 185, centerY, { align: "right" })
    yPos += actualRowHeight
  })

  yPos += 15
  if (yPos + 65 > maxYPos) {
    doc.addPage()
    yPos = drawContinuationHeader()
    yPos += 10
  }

  doc.setFillColor(249, 250, 251)
  doc.rect(120, yPos - 2, 70, 12, "F")
  doc.setFontSize(13)
  doc.setTextColor(...brandColor)
  doc.text("TOTAL:", 155, yPos + 6, { align: "right" })
  doc.setFontSize(16)
  doc.setTextColor(...blackColor)
  doc.text(formatPdfCurrency(poundsFromPence(invoice.total)), 185, yPos + 6, { align: "right" })
  yPos += 25

  doc.setFontSize(13)
  doc.setTextColor(...brandColor)
  doc.text("PAYMENT DETAILS:", 20, yPos)
  yPos += 15

  const paymentBoxY = yPos - 2
  const paymentBoxHeight = 32
  doc.setDrawColor(220, 220, 220)
  doc.setLineWidth(0.5)
  doc.rect(20, paymentBoxY, 170, paymentBoxHeight)

  const leftColumnX = 25
  const paymentRightColumnX = 115
  let leftYPos = yPos + 2

  doc.setFontSize(9)
  doc.setTextColor(...grayColor)
  doc.text("Beneficiary:", leftColumnX, leftYPos)
  leftYPos += 4
  doc.setFontSize(10)
  doc.setTextColor(...blackColor)
  doc.text(beneficiary, leftColumnX, leftYPos)
  leftYPos += 7

  doc.setFontSize(9)
  doc.setTextColor(...grayColor)
  doc.text("Sort Code:", leftColumnX, leftYPos)
  leftYPos += 4
  doc.setFontSize(10)
  doc.setTextColor(...blackColor)
  doc.text(sortCode, leftColumnX, leftYPos)
  leftYPos += 7

  doc.setFontSize(9)
  doc.setTextColor(...grayColor)
  doc.text("Account Number:", leftColumnX, leftYPos)
  leftYPos += 4
  doc.setFontSize(10)
  doc.setTextColor(...blackColor)
  doc.text(accountNumber, leftColumnX, leftYPos)

  const leftColumnStartY = yPos + 2
  const leftColumnTotalHeight = leftYPos - leftColumnStartY
  const bankLineSpacing = 5
  const bankContentHeight = 4 * bankLineSpacing
  let bankYPos = leftColumnStartY + (leftColumnTotalHeight - bankContentHeight) / 2
  doc.setFontSize(9)
  doc.setTextColor(...grayColor)
  doc.text("Bank Address:", paymentRightColumnX, bankYPos)
  bankYPos += bankLineSpacing
  doc.setFontSize(10)
  doc.setTextColor(...blackColor)
  doc.text("Monzo Bank Ltd", paymentRightColumnX, bankYPos)
  bankYPos += bankLineSpacing
  doc.text("Broadwalk House", paymentRightColumnX, bankYPos)
  bankYPos += bankLineSpacing
  doc.text("5 Appold Street", paymentRightColumnX, bankYPos)
  bankYPos += bankLineSpacing
  doc.text("London, EC2A 2AG", paymentRightColumnX, bankYPos)

  yPos = paymentBoxY + paymentBoxHeight + 10
  doc.setFontSize(10)
  doc.setTextColor(...grayColor)
  doc.text("Thank you for your business!", 105, yPos, { align: "center" })
  if (invoice.dueDate && invoice.status === "sent") {
    yPos += 6
    doc.text(`Payment is due by ${formatPdfDate(invoice.dueDate)}`, 105, yPos, { align: "center" })
  }

  return doc.output("arraybuffer")
}
