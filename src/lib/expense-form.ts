import { EXPENSE_PAYMENT_METHODS } from "./constants"

export type ExpenseFormInput = {
  categoryId: unknown
  date: unknown
  supplier: unknown
  description: unknown
  netAmount: unknown
  vatRate: unknown
  paymentMethod: unknown
  reference: unknown
  clientId: unknown
  notes: unknown
  isReimbursable: unknown
  isBillable: unknown
}

export type ParsedExpenseForm = {
  categoryId: string
  clientId: string | null
  date: Date
  supplier: string
  description: string
  netAmount: number
  vatAmount: number
  grossAmount: number
  vatRate: number
  paymentMethod: (typeof EXPENSE_PAYMENT_METHODS)[number]
  reference: string
  notes: string
  isReimbursable: boolean
  isBillable: boolean
}

export type ExpenseFormActionState = {
  errors: Record<string, string>
  values: Record<string, string>
}

export class ExpenseFormValidationError extends Error {
  constructor(readonly field: string, message: string) {
    super(message)
    this.name = "ExpenseFormValidationError"
  }
}

const MIN_INT = -2_147_483_648
const MAX_INT = 2_147_483_647

function text(value: unknown, field: string, required = false, maxLength = 2000): string {
  if (typeof value !== "string") throw new ExpenseFormValidationError(field, "Enter valid text.")
  const clean = value.trim()
  if (required && !clean) throw new ExpenseFormValidationError(field, "This field is required.")
  if (clean.length > maxLength) throw new ExpenseFormValidationError(field, "This field is too long.")
  return clean
}

function parsePence(value: unknown): number {
  if (typeof value !== "string") throw new ExpenseFormValidationError("netAmount", "Enter an amount with up to two decimal places.")
  const clean = value.trim()
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(clean)) throw new ExpenseFormValidationError("netAmount", "Enter an amount with up to two decimal places.")
  const negative = clean.startsWith("-")
  const [whole, fraction = ""] = clean.replace(/^-/, "").split(".")
  const pence = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
  const signedPence = negative ? -pence : pence
  if (!Number.isSafeInteger(signedPence) || signedPence === 0 || signedPence < MIN_INT || signedPence > MAX_INT) throw new ExpenseFormValidationError("netAmount", "Amount must be non-zero and within the supported range.")
  return signedPence
}

export function parseExpenseForm(input: ExpenseFormInput): ParsedExpenseForm {
  const categoryId = text(input.categoryId, "categoryId", true, 100)
  const dateText = text(input.date, "date", true, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) throw new ExpenseFormValidationError("date", "Enter a valid date.")
  const date = new Date(`${dateText}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateText) throw new ExpenseFormValidationError("date", "Enter a valid date.")

  const description = text(input.description, "description", true, 500)
  const supplier = text(input.supplier ?? "", "supplier", false, 200)
  const reference = text(input.reference ?? "", "reference", false, 200)
  const notes = text(input.notes ?? "", "notes", false, 2000)
  const clientText = text(input.clientId ?? "", "clientId", false, 100)
  const netAmount = parsePence(input.netAmount)
  const rateText = text(input.vatRate, "vatRate", true, 3)
  if (!(["0", "5", "20"] as const).includes(rateText as "0" | "5" | "20")) throw new ExpenseFormValidationError("vatRate", "Choose a supported VAT rate.")
  const vatRate = Number(rateText)
  const vatAmount = vatRate === 0 ? 0 : Math.round(netAmount * vatRate / 100)
  const grossAmount = netAmount + vatAmount
  if (!Number.isSafeInteger(vatAmount) || !Number.isSafeInteger(grossAmount) || vatAmount < MIN_INT || vatAmount > MAX_INT || grossAmount < MIN_INT || grossAmount > MAX_INT) throw new ExpenseFormValidationError("netAmount", "Amount is outside the supported range.")

  const method = text(input.paymentMethod, "paymentMethod", true, 40)
  if (!(EXPENSE_PAYMENT_METHODS as readonly string[]).includes(method)) throw new ExpenseFormValidationError("paymentMethod", "Choose a supported payment method.")

  return {
    categoryId,
    clientId: clientText || null,
    date,
    supplier,
    description,
    netAmount,
    vatAmount,
    grossAmount,
    vatRate,
    paymentMethod: method as ParsedExpenseForm["paymentMethod"],
    reference,
    notes,
    isReimbursable: input.isReimbursable === true || input.isReimbursable === "on",
    isBillable: input.isBillable === true || input.isBillable === "on",
  }
}
