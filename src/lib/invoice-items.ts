import { parseCurrency } from "./format"

export const PG_INT_MAX = 2_147_483_647
export const MAX_LINE_QUANTITY = 1_000_000
export const BUSINESS_AREA_VALUES = ["CREATIVE", "DEVELOPMENT", "SUPPORT"] as const

export type InvoiceBusinessArea = (typeof BUSINESS_AREA_VALUES)[number]

export type BuiltInvoiceItem = {
  description: string
  quantity: number
  unitPrice: number
  vatRate: number
  discount: number
  lineTotal: number
  vatAmount: number
  agencyCommission: number
  businessArea: string
  sortOrder: number
}

export function calculateInvoiceDraftLine(quantity: number, unitPricePence: number, commissionPercent: number) {
  const gross = Math.round(quantity * unitPricePence)
  const commissionAmount = commissionPercent > 0 ? Math.round(gross * (commissionPercent / 100)) : 0
  const lineTotal = Math.max(0, gross - commissionAmount)
  return { gross, commissionAmount, lineTotal, vatAmount: 0 }
}

function assertSafePence(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value > PG_INT_MAX) {
    throw new Error(`Invalid ${label}`)
  }
}

function parseQuantity(value: string): number {
  const quantity = Number(value)
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_LINE_QUANTITY) {
    throw new Error("Invalid quantity")
  }
  return quantity
}

function parseCommission(value: string): number {
  const commission = Number(value || "0")
  if (!Number.isFinite(commission) || commission < 0 || commission > 100) {
    throw new Error("Invalid commission")
  }
  return commission
}

function parseBusinessArea(value: string | undefined): InvoiceBusinessArea {
  const area = (value || "DEVELOPMENT").toUpperCase()
  if ((BUSINESS_AREA_VALUES as readonly string[]).includes(area)) {
    return area as InvoiceBusinessArea
  }
  throw new Error("Invalid business area")
}

function parseUnitPricePence(value: string): number {
  const cleaned = value.replace(/[^0-9.-]/g, "")
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") {
    throw new Error("Invalid rate")
  }
  const pounds = Number(cleaned)
  if (!Number.isFinite(pounds) || pounds < 0) {
    throw new Error("Invalid rate")
  }
  const pence = parseCurrency(value)
  assertSafePence(pence, "rate")
  return pence
}

export function buildValidatedInvoiceItems(input: {
  descriptions: string[]
  quantities: string[]
  unitPrices: string[]
  commissions: string[]
  areas: string[]
}): BuiltInvoiceItem[] {
  const items: BuiltInvoiceItem[] = []
  let subtotal = 0

  for (let index = 0; index < input.descriptions.length; index += 1) {
    const description = (input.descriptions[index] || "").trim()
    if (!description) continue

    const quantity = parseQuantity(input.quantities[index] || "")
    const unitPrice = parseUnitPricePence(input.unitPrices[index] || "")
    const agencyCommission = parseCommission(input.commissions[index] || "0")
    const { lineTotal, vatAmount } = calculateInvoiceDraftLine(quantity, unitPrice, agencyCommission)
    assertSafePence(lineTotal, "line total")
    subtotal += lineTotal
    assertSafePence(subtotal, "subtotal")

    items.push({
      description,
      quantity,
      unitPrice,
      vatRate: 0,
      discount: 0,
      lineTotal,
      vatAmount,
      agencyCommission,
      businessArea: parseBusinessArea(input.areas[index]),
      sortOrder: items.length,
    })
  }

  return items
}

export function poundsInputFromPence(pence: number): string {
  return (pence / 100).toFixed(2)
}

export function quantityInputFromValue(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : String(quantity)
}
