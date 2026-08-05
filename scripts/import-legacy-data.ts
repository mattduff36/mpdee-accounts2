import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { Client as PgClient } from "pg"
import { EXPENSE_CATEGORIES } from "../src/lib/constants"
import { loadLocalEnv } from "./load-env"

loadLocalEnv()

interface LegacyClient {
  id: string
  name: string
  email: string
  phone: string | null
  billing_address: string | null
  notes: string | null
  image_url: string | null
  created_at: Date
  updated_at: Date
}

interface LegacyInvoice {
  id: string
  client_id: string
  invoice_number: string
  issue_date: Date
  due_date: Date | null
  total_amount: number
  status: string
  notes: string | null
  created_at: Date
  updated_at: Date
  sent_date: Date | null
  paid_date: Date | null
}

interface LegacyInvoiceItem {
  id: string
  invoice_id: string
  description: string
  quantity: number
  unit_price: number
  total_price: number
  rate: number | null
  total: number | null
  agency_commission: number
  business_area: string
  created_at: Date
  updated_at: Date
}

interface LegacyExpense {
  id: string
  description: string
  amount: number
  category: string
  date: Date
  receipt_url: string | null
  notes: string | null
  created_at: Date
  updated_at: Date
}

interface LegacyBankImport {
  id: string
  filename: string | null
  uploaded_at: Date
}

interface LegacyBankTransaction {
  id: string
  import_id: string
  date: Date
  description: string
  amount: number
  raw: unknown
  status: string
  expense_id: string | null
}

interface LegacyData {
  clients: LegacyClient[]
  invoices: LegacyInvoice[]
  invoiceItems: LegacyInvoiceItem[]
  expenses: LegacyExpense[]
  bankImports: LegacyBankImport[]
  bankTransactions: LegacyBankTransaction[]
}

interface ImportSummary {
  clients: number
  invoices: number
  invoiceItems: number
  expenses: number
  bankImports: number
  bankTransactions: number
  payments: number
}

const PLACEHOLDER_DATABASE_URL_PARTS = ["USER:PASSWORD@HOST", "mpdee_accounts2"]
const DEFAULT_PAYMENT_TERMS = getEnvInt("DEFAULT_PAYMENT_TERMS", 30)

function getEnvInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || "", 10)
  return Number.isFinite(value) ? value : fallback
}

function poundsToPence(value: number | null | undefined): number {
  return Math.round(Number(value || 0) * 100)
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function isPlaceholderTargetUrl() {
  const databaseUrl = process.env.DATABASE_URL || ""
  return !databaseUrl || PLACEHOLDER_DATABASE_URL_PARTS.some((part) => databaseUrl.includes(part))
}

function getMode() {
  if (process.argv.includes("--import")) return "import"
  if (process.argv.includes("--clear-target")) return "clear-target"
  return "dry-run"
}

function mapInvoiceStatus(status: string): string {
  const statusMap: Record<string, string> = {
    DRAFT: "draft",
    SENT: "sent",
    PAID: "paid",
    OVERDUE: "overdue",
  }

  return statusMap[status] || "draft"
}

function mapTransactionStatus(status: string): string {
  const statusMap: Record<string, string> = {
    PENDING: "pending",
    ADDED: "matched",
    IGNORED: "ignored",
  }

  return statusMap[status] || "pending"
}

function getCategoryColor(categoryName: string): string {
  const category = EXPENSE_CATEGORIES.find((item) => item.name.toLowerCase() === categoryName.toLowerCase())
  return category?.color || "#6B7280"
}

function withLegacyNote(notes: string | null | undefined, legacyId: string): string {
  const baseNotes = notes?.trim()
  const legacyNote = `Legacy ID: ${legacyId}`
  return baseNotes ? `${baseNotes}\n\n${legacyNote}` : legacyNote
}

function getRawTransactionNote(transaction: LegacyBankTransaction): string {
  const notes = [`Legacy ID: ${transaction.id}`]
  if (transaction.expense_id) notes.push(`Legacy expense ID: ${transaction.expense_id}`)
  if (transaction.raw) notes.push(`Legacy raw row: ${JSON.stringify(transaction.raw)}`)
  return notes.join("\n")
}

function getCompanySettingsData() {
  const businessName = process.env.COMPANY_NAME || "My Business"
  const companyEmail = process.env.COMPANY_EMAIL || process.env.EMAIL_FROM || undefined
  const emailFromName = process.env.EMAIL_FROM_NAME || businessName
  const emailFromAddress = process.env.EMAIL_FROM || companyEmail

  return {
    businessName,
    tradingName: businessName,
    email: companyEmail,
    phone: process.env.COMPANY_PHONE || undefined,
    addressLine1: process.env.COMPANY_ADDRESS || undefined,
    country: "United Kingdom",
    invoicePrefix: process.env.INVOICE_PREFIX || "INV",
    defaultPaymentTerms: DEFAULT_PAYMENT_TERMS,
    vatRegistered: false,
    defaultVatRate: 20,
    emailFromName,
    emailFromAddress,
    emailProvider: process.env.EMAIL_PROVIDER || "mock",
  }
}

async function createLegacyClient() {
  const connectionString = process.env.LEGACY_DATABASE_URL
  if (!connectionString) throw new Error("LEGACY_DATABASE_URL is required")

  const client = new PgClient({ connectionString })
  await client.connect()
  return client
}

async function readLegacyData(client: PgClient): Promise<LegacyData> {
  await client.query("BEGIN READ ONLY")
  try {
    const clients = await client.query<LegacyClient>("select * from clients order by created_at asc")
    const invoices = await client.query<LegacyInvoice>("select * from invoices order by created_at asc")
    const invoiceItems = await client.query<LegacyInvoiceItem>("select * from invoice_items order by created_at asc")
    const expenses = await client.query<LegacyExpense>("select * from expenses order by created_at asc")
    const bankImports = await client.query<LegacyBankImport>("select * from bank_statement_imports order by uploaded_at asc")
    const bankTransactions = await client.query<LegacyBankTransaction>("select * from bank_transactions order by date asc")
    await client.query("COMMIT")

    return {
      clients: clients.rows,
      invoices: invoices.rows,
      invoiceItems: invoiceItems.rows,
      expenses: expenses.rows,
      bankImports: bankImports.rows,
      bankTransactions: bankTransactions.rows,
    }
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
}

function summarizeLegacyData(data: LegacyData) {
  const invoiceTotal = data.invoices.reduce((total, invoice) => total + poundsToPence(invoice.total_amount), 0)
  const expenseTotal = data.expenses.reduce((total, expense) => total + poundsToPence(expense.amount), 0)
  const bankTransactionTotal = data.bankTransactions.reduce((total, transaction) => total + poundsToPence(transaction.amount), 0)

  return {
    clients: data.clients.length,
    invoices: data.invoices.length,
    invoiceItems: data.invoiceItems.length,
    invoiceTotal,
    expenses: data.expenses.length,
    expenseTotal,
    bankImports: data.bankImports.length,
    bankTransactions: data.bankTransactions.length,
    bankTransactionTotal,
  }
}

async function bootstrapTarget(prisma: PrismaClient) {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com"
  const adminPassword = process.env.ADMIN_PASSWORD || "changeme123"

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { name: "Admin User", role: "admin", isActive: true },
    create: {
      email: adminEmail,
      name: "Admin User",
      password: await bcrypt.hash(adminPassword, 12),
      role: "admin",
    },
  })

  await prisma.companySettings.upsert({
    where: { id: "default" },
    update: getCompanySettingsData(),
    create: { id: "default", ...getCompanySettingsData() },
  })

  for (const category of EXPENSE_CATEGORIES) {
    await prisma.expenseCategory.upsert({
      where: { name: category.name },
      update: { color: category.color },
      create: { name: category.name, color: category.color },
    })
  }
}

async function clearTarget(prisma: PrismaClient) {
  await prisma.$transaction([
    prisma.reminderLog.deleteMany(),
    prisma.emailLog.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.creditNote.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.invoiceItem.deleteMany(),
    prisma.quoteItem.deleteMany(),
    prisma.recurringInvoiceItem.deleteMany(),
    prisma.bankTransaction.deleteMany(),
    prisma.bankImport.deleteMany(),
    prisma.expense.deleteMany(),
    prisma.mileageExpense.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.quote.deleteMany(),
    prisma.recurringInvoice.deleteMany(),
    prisma.client.deleteMany(),
  ])
}

async function importClients(prisma: PrismaClient, data: LegacyData) {
  const clientIdMap = new Map<string, string>()

  for (const client of data.clients) {
    const existingClient = client.email
      ? await prisma.client.findFirst({ where: { email: client.email } })
      : await prisma.client.findFirst({ where: { notes: { contains: `Legacy ID: ${client.id}` } } })

    const clientData = {
      name: client.name,
      companyName: client.name,
      email: client.email || undefined,
      phone: client.phone || undefined,
      addressLine1: client.billing_address || undefined,
      notes: withLegacyNote(client.notes, client.id),
      paymentTerms: DEFAULT_PAYMENT_TERMS,
      createdAt: client.created_at,
      updatedAt: client.updated_at,
    }

    const targetClient = existingClient
      ? await prisma.client.update({ where: { id: existingClient.id }, data: clientData })
      : await prisma.client.create({ data: clientData })

    clientIdMap.set(client.id, targetClient.id)
  }

  return clientIdMap
}

async function importInvoices(prisma: PrismaClient, data: LegacyData, clientIdMap: Map<string, string>) {
  const invoiceIdMap = new Map<string, string>()
  const itemsByInvoiceId = new Map<string, LegacyInvoiceItem[]>()
  let invoiceItemCount = 0
  let paymentCount = 0

  for (const item of data.invoiceItems) {
    const items = itemsByInvoiceId.get(item.invoice_id) || []
    items.push(item)
    itemsByInvoiceId.set(item.invoice_id, items)
  }

  for (const invoice of data.invoices) {
    const clientId = clientIdMap.get(invoice.client_id)
    if (!clientId) continue

    const legacyItems = itemsByInvoiceId.get(invoice.id) || []
    const itemData = legacyItems.map((item, sortOrder) => {
      const unitPrice = poundsToPence(item.rate ?? item.unit_price)
      const lineTotal = poundsToPence(item.total ?? item.total_price)
      const description = item.business_area ? `${item.description} (Legacy area: ${item.business_area.toLowerCase()})` : item.description

      return {
        description,
        quantity: item.quantity,
        unitPrice,
        vatRate: 0,
        lineTotal,
        vatAmount: 0,
        sortOrder,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }
    })
    const subtotalFromItems = itemData.reduce((total, item) => total + item.lineTotal, 0)
    const total = poundsToPence(invoice.total_amount)
    const subtotal = subtotalFromItems || total
    const isPaid = invoice.status === "PAID"
    const amountPaid = isPaid ? total : 0

    const invoiceData = {
      clientId,
      status: mapInvoiceStatus(invoice.status),
      issueDate: invoice.issue_date,
      dueDate: invoice.due_date || addDays(invoice.issue_date, DEFAULT_PAYMENT_TERMS),
      paymentTerms: DEFAULT_PAYMENT_TERMS,
      subtotal,
      vatTotal: 0,
      discountTotal: 0,
      total,
      amountPaid,
      balanceDue: total - amountPaid,
      notes: withLegacyNote(invoice.notes, invoice.id),
      vatEnabled: false,
      sentAt: invoice.sent_date || undefined,
      paidAt: invoice.paid_date || undefined,
      createdAt: invoice.created_at,
      updatedAt: invoice.updated_at,
    }

    const existingInvoice = await prisma.invoice.findUnique({ where: { invoiceNumber: invoice.invoice_number } })
    const targetInvoice = existingInvoice
      ? await prisma.invoice.update({
          where: { invoiceNumber: invoice.invoice_number },
          data: { ...invoiceData, items: { deleteMany: {}, create: itemData } },
        })
      : await prisma.invoice.create({
          data: { invoiceNumber: invoice.invoice_number, ...invoiceData, items: { create: itemData } },
        })

    invoiceIdMap.set(invoice.id, targetInvoice.id)
    invoiceItemCount += itemData.length

    if (isPaid) {
      await prisma.payment.deleteMany({ where: { reference: `LEGACY-INVOICE-${invoice.id}` } })
      await prisma.payment.create({
        data: {
          invoiceId: targetInvoice.id,
          clientId,
          amount: total,
          date: invoice.paid_date || invoice.updated_at,
          method: "bank_transfer",
          reference: `LEGACY-INVOICE-${invoice.id}`,
          notes: "Generated from legacy paid invoice status.",
          createdAt: invoice.updated_at,
          updatedAt: invoice.updated_at,
        },
      })
      paymentCount += 1
    }
  }

  return { invoiceIdMap, invoiceItemCount, paymentCount }
}

async function importExpenses(prisma: PrismaClient, data: LegacyData) {
  let expenseCount = 0

  for (const expense of data.expenses) {
    const categoryName = expense.category || "Other"
    const category = await prisma.expenseCategory.upsert({
      where: { name: categoryName },
      update: { color: getCategoryColor(categoryName) },
      create: { name: categoryName, color: getCategoryColor(categoryName) },
    })
    const amount = poundsToPence(expense.amount)
    const existingExpense = await prisma.expense.findFirst({ where: { reference: `LEGACY-EXPENSE-${expense.id}` } })
    const expenseData = {
      categoryId: category.id,
      date: expense.date,
      supplier: undefined,
      description: expense.description,
      netAmount: amount,
      vatAmount: 0,
      grossAmount: amount,
      vatRate: 0,
      paymentMethod: "bank_transfer",
      reference: `LEGACY-EXPENSE-${expense.id}`,
      receiptUrl: expense.receipt_url || undefined,
      notes: withLegacyNote(expense.notes, expense.id),
      createdAt: expense.created_at,
      updatedAt: expense.updated_at,
    }

    if (existingExpense) await prisma.expense.update({ where: { id: existingExpense.id }, data: expenseData })
    else await prisma.expense.create({ data: expenseData })

    expenseCount += 1
  }

  return expenseCount
}

async function importBankData(prisma: PrismaClient, data: LegacyData) {
  const transactionsByImportId = new Map<string, LegacyBankTransaction[]>()
  let bankTransactionCount = 0

  for (const transaction of data.bankTransactions) {
    const transactions = transactionsByImportId.get(transaction.import_id) || []
    transactions.push(transaction)
    transactionsByImportId.set(transaction.import_id, transactions)
  }

  for (const bankImport of data.bankImports) {
    const transactions = transactionsByImportId.get(bankImport.id) || []
    const existingImport = await prisma.bankImport.findFirst({ where: { notes: { contains: `Legacy ID: ${bankImport.id}` } } })
    const importData = {
      fileName: bankImport.filename || `legacy-bank-import-${bankImport.id}.csv`,
      importDate: bankImport.uploaded_at,
      rowCount: transactions.length,
      matchedCount: transactions.filter((transaction) => transaction.status === "ADDED").length,
      ignoredCount: transactions.filter((transaction) => transaction.status === "IGNORED").length,
      duplicateCount: 0,
      notes: `Legacy ID: ${bankImport.id}`,
      createdAt: bankImport.uploaded_at,
      updatedAt: bankImport.uploaded_at,
      transactions: {
        deleteMany: {},
        create: transactions.map((transaction) => ({
          date: transaction.date,
          description: transaction.description,
          reference: transaction.expense_id ? `LEGACY-EXPENSE-${transaction.expense_id}` : undefined,
          amount: poundsToPence(transaction.amount),
          type: transaction.amount >= 0 ? "credit" : "debit",
          status: mapTransactionStatus(transaction.status),
          notes: getRawTransactionNote(transaction),
          createdAt: bankImport.uploaded_at,
          updatedAt: bankImport.uploaded_at,
        })),
      },
    }

    if (existingImport) await prisma.bankImport.update({ where: { id: existingImport.id }, data: importData })
    else await prisma.bankImport.create({ data: importData })

    bankTransactionCount += transactions.length
  }

  return {
    bankImports: data.bankImports.length,
    bankTransactions: bankTransactionCount,
  }
}

async function importLegacyData(prisma: PrismaClient, data: LegacyData): Promise<ImportSummary> {
  await bootstrapTarget(prisma)

  const clientIdMap = await importClients(prisma, data)
  const invoiceResult = await importInvoices(prisma, data, clientIdMap)
  const expenses = await importExpenses(prisma, data)
  const bankResult = await importBankData(prisma, data)

  return {
    clients: clientIdMap.size,
    invoices: invoiceResult.invoiceIdMap.size,
    invoiceItems: invoiceResult.invoiceItemCount,
    expenses,
    bankImports: bankResult.bankImports,
    bankTransactions: bankResult.bankTransactions,
    payments: invoiceResult.paymentCount,
  }
}

async function getTargetSummary(prisma: PrismaClient) {
  const [clients, invoices, invoiceItems, expenses, bankImports, bankTransactions, invoiceTotals, expenseTotals, bankTotals] = await Promise.all([
    prisma.client.count(),
    prisma.invoice.count(),
    prisma.invoiceItem.count(),
    prisma.expense.count(),
    prisma.bankImport.count(),
    prisma.bankTransaction.count(),
    prisma.invoice.aggregate({ _sum: { total: true } }),
    prisma.expense.aggregate({ _sum: { grossAmount: true } }),
    prisma.bankTransaction.aggregate({ _sum: { amount: true } }),
  ])

  return {
    clients,
    invoices,
    invoiceItems,
    invoiceTotal: invoiceTotals._sum.total || 0,
    expenses,
    expenseTotal: expenseTotals._sum.grossAmount || 0,
    bankImports,
    bankTransactions,
    bankTransactionTotal: bankTotals._sum.amount || 0,
  }
}

async function main() {
  const mode = getMode()

  if ((mode === "import" || mode === "clear-target") && isPlaceholderTargetUrl()) {
    throw new Error("DATABASE_URL must point at the separate new Postgres database before writing target data")
  }

  if (mode === "clear-target") {
    if (!process.argv.includes("--yes")) throw new Error("Refusing to clear target without --yes")

    const prisma = new PrismaClient()
    await clearTarget(prisma)
    await prisma.$disconnect()
    console.log("Cleared target business data; users, settings, and categories were left in place.")
    return
  }

  const legacyClient = await createLegacyClient()
  try {
    const legacyData = await readLegacyData(legacyClient)
    console.log("Legacy source summary:", summarizeLegacyData(legacyData))

    if (mode === "dry-run") {
      if (!isPlaceholderTargetUrl()) {
        const prisma = new PrismaClient()
        console.log("Current target summary:", await getTargetSummary(prisma))
        await prisma.$disconnect()
      } else {
        console.log("Target summary skipped because DATABASE_URL is still a placeholder.")
      }
      return
    }

    const prisma = new PrismaClient()
    const summary = await importLegacyData(prisma, legacyData)
    console.log("Imported legacy data:", summary)
    console.log("Target summary after import:", await getTargetSummary(prisma))
    await prisma.$disconnect()
  } finally {
    await legacyClient.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
