export type ImportedInvoiceItem = {
  description: string
  quantity: string
  unitPrice: string
  agencyCommission: string
  businessArea: "CREATIVE" | "DEVELOPMENT" | "SUPPORT"
}

export type ImportedInvoiceDraft = {
  issueDate: string | null
  dueDate: string | null
  notes: string
  internalNotes: string
  items: ImportedInvoiceItem[]
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const HOURS_AMOUNT_SUFFIX = /\s+—\s+\d+(?:\.\d+)?h × £[\d.]+ = £[\d.]+\s*$/

export function addCalendarDays(isoDate: string, days: number): string {
  const match = ISO_DAY.exec(isoDate)
  if (!match) return isoDate
  const date = new Date(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)))
  date.setDate(date.getDate() + days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function formatQuantity(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : String(hours)
}

function formatPounds(value: number): string {
  return value.toFixed(2)
}

function mapBusinessArea(kind: unknown): ImportedInvoiceItem["businessArea"] {
  const normalised = asString(kind).toLowerCase()
  if (normalised === "support") return "SUPPORT"
  if (normalised === "creative") return "CREATIVE"
  return "DEVELOPMENT"
}

function lineDescription(line: Record<string, unknown>): string {
  const text = asString(line.text).replace(HOURS_AMOUNT_SUFFIX, "").trim()
  if (text) return text

  const label = asString(line.label)
  const dateLabel = asString(line.dateLabel)
  const heading = asString(line.heading)
  const description = asString(line.description)
  const body = heading && description ? `${heading} — ${description}` : heading || description
  const prefix = [label, dateLabel].filter(Boolean).join(": ")
  if (prefix && body) return `${prefix} (${body})`
  return prefix || body
}

function parseLine(line: unknown, index: number): ImportedInvoiceItem {
  const record = asRecord(line)
  if (!record) {
    throw new Error(`Line ${index + 1} is not a valid invoice item.`)
  }

  const hours = asFiniteNumber(record.hours)
  const rate = asFiniteNumber(record.rate)
  if (hours == null || rate == null) {
    throw new Error(`Line ${index + 1} is missing hours or rate.`)
  }

  const description = lineDescription(record)
  if (!description) {
    throw new Error(`Line ${index + 1} is missing a description.`)
  }

  return {
    description,
    quantity: formatQuantity(hours),
    unitPrice: formatPounds(rate),
    agencyCommission: "0",
    businessArea: mapBusinessArea(record.kind),
  }
}

export function parseInvoiceImportJson(raw: string, options?: { paymentTerms?: number }): ImportedInvoiceDraft {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("This file is not valid JSON.")
  }

  const record = asRecord(parsed)
  if (!record) {
    throw new Error("This JSON is not a recognised invoice export.")
  }

  if (record.schemaVersion != null && record.schemaVersion !== 1 && record.schemaVersion !== "1") {
    throw new Error("Unsupported invoice export version. Expected schemaVersion 1.")
  }

  if (!Array.isArray(record.lines)) {
    throw new Error("This JSON is not a final invoice export. Import a file with a lines array (schemaVersion 1).")
  }

  if (record.lines.length === 0) {
    throw new Error("This invoice export does not contain any line items.")
  }

  const period = asRecord(record.period)
  const issueDate = period && ISO_DAY.test(asString(period.to)) ? asString(period.to) : null
  const paymentTerms = options?.paymentTerms
  const dueDate =
    issueDate && paymentTerms != null && Number.isFinite(paymentTerms) ? addCalendarDays(issueDate, Number(paymentTerms)) : null

  const coverageNotes = Array.isArray(record.coverageNotes)
    ? record.coverageNotes.map(asString).filter(Boolean).join("\n\n")
    : ""

  return {
    issueDate,
    dueDate,
    notes: asString(record.title),
    internalNotes: coverageNotes,
    items: record.lines.map(parseLine),
  }
}
