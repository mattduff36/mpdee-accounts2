import { PrismaClient } from "@prisma/client"
import { hashPassword } from "../src/lib/auth"
import { EXPENSE_CATEGORIES } from "../src/lib/constants"
import { loadLocalEnv } from "../scripts/load-env"

loadLocalEnv()
const prisma = new PrismaClient()

interface InvoiceItemSeed {
  description: string
  quantity: number
  unitPrice: number
  vatRate?: number
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function pounds(value: number): number {
  return Math.round(value * 100)
}

function getEnvInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || "", 10)
  return Number.isFinite(value) ? value : fallback
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
    defaultPaymentTerms: getEnvInt("DEFAULT_PAYMENT_TERMS", 30),
    vatRegistered: false,
    defaultVatRate: 20,
    emailFromName,
    emailFromAddress,
    emailProvider: process.env.EMAIL_PROVIDER || "mock",
  }
}

function getInvoiceTotals(items: InvoiceItemSeed[]) {
  return items.reduce(
    (totals, item) => {
      const vatRate = item.vatRate ?? 20
      const lineTotal = Math.round(item.quantity * item.unitPrice)
      const vatAmount = vatRate > 0 ? Math.round(lineTotal * (vatRate / 100)) : 0

      return {
        subtotal: totals.subtotal + lineTotal,
        vatTotal: totals.vatTotal + vatAmount,
        total: totals.total + lineTotal + vatAmount,
      }
    },
    { subtotal: 0, vatTotal: 0, total: 0 },
  )
}

function getInvoiceItemData(items: InvoiceItemSeed[]) {
  return items.map((item, sortOrder) => {
    const vatRate = item.vatRate ?? 20
    const lineTotal = Math.round(item.quantity * item.unitPrice)
    const vatAmount = vatRate > 0 ? Math.round(lineTotal * (vatRate / 100)) : 0

    return {
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatRate,
      lineTotal,
      vatAmount,
      sortOrder,
    }
  })
}

async function upsertClient(email: string, data: Parameters<typeof prisma.client.create>[0]["data"]) {
  const existingClient = await prisma.client.findFirst({ where: { email } })
  if (existingClient) return prisma.client.update({ where: { id: existingClient.id }, data })

  return prisma.client.create({ data })
}

async function upsertInvoice({
  invoiceNumber,
  clientId,
  status,
  issueDate,
  dueDate,
  amountPaid = 0,
  sentAt,
  paidAt,
  notes,
  items,
}: {
  invoiceNumber: string
  clientId: string
  status: string
  issueDate: Date
  dueDate: Date
  amountPaid?: number
  sentAt?: Date
  paidAt?: Date
  notes?: string
  items: InvoiceItemSeed[]
}) {
  const totals = getInvoiceTotals(items)
  const data = {
    clientId,
    status,
    issueDate,
    dueDate,
    paymentTerms: 30,
    subtotal: totals.subtotal,
    vatTotal: totals.vatTotal,
    total: totals.total,
    amountPaid,
    balanceDue: totals.total - amountPaid,
    notes,
    vatEnabled: true,
    sentAt,
    paidAt,
  }
  const itemData = getInvoiceItemData(items)
  const existingInvoice = await prisma.invoice.findUnique({ where: { invoiceNumber } })

  if (existingInvoice) {
    return prisma.invoice.update({
      where: { invoiceNumber },
      data: {
        ...data,
        items: {
          deleteMany: {},
          create: itemData,
        },
      },
    })
  }

  return prisma.invoice.create({
    data: {
      invoiceNumber,
      ...data,
      items: {
        create: itemData,
      },
    },
  })
}

async function seedCoreData() {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com"
  const adminPassword = process.env.ADMIN_PASSWORD || "changeme123"
  const existingUser = await prisma.user.findUnique({ where: { email: adminEmail } })

  if (!existingUser) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: "Admin User",
        password: await hashPassword(adminPassword),
        role: "admin",
      },
    })
    console.log("Created default user")
  }

  const companySettings = getCompanySettingsData()
  await prisma.companySettings.upsert({
    where: { id: "default" },
    update: companySettings,
    create: {
      id: "default",
      ...companySettings,
    },
  })

  for (const cat of EXPENSE_CATEGORIES) {
    await prisma.expenseCategory.upsert({
      where: { name: cat.name },
      update: { color: cat.color },
      create: { name: cat.name, color: cat.color },
    })
  }

  console.log("Seeded core data")
}

async function seedDemoData() {
  const now = new Date()
  const acme = await upsertClient("accounts@acme-studio.test", {
    name: "Acme Studio",
    companyName: "Acme Studio Ltd",
    email: "accounts@acme-studio.test",
    phone: "0161 555 0101",
    addressLine1: "14 Example Yard",
    city: "Manchester",
    postcode: "M4 4DE",
    contactName: "Alex Morgan",
    vatNumber: "GB123456789",
    paymentTerms: 30,
    notes: "Demo client for local testing.",
  })
  const northwind = await upsertClient("finance@northwind-demo.test", {
    name: "Northwind Demo",
    companyName: "Northwind Traders Ltd",
    email: "finance@northwind-demo.test",
    phone: "020 5555 0188",
    addressLine1: "200 Sample Road",
    city: "London",
    postcode: "SE1 1AA",
    contactName: "Priya Shah",
    paymentTerms: 14,
    notes: "Uses shorter payment terms for testing due dates.",
  })
  const bright = await upsertClient("owner@bright-cafe.test", {
    name: "Bright Cafe",
    companyName: "Bright Cafe Ltd",
    email: "owner@bright-cafe.test",
    phone: "0113 555 0130",
    addressLine1: "8 Demo Arcade",
    city: "Leeds",
    postcode: "LS1 2AB",
    contactName: "Sam Taylor",
    paymentTerms: 30,
  })

  const paidInvoice = await upsertInvoice({
    invoiceNumber: "INV-0001",
    clientId: acme.id,
    status: "paid",
    issueDate: addDays(now, -45),
    dueDate: addDays(now, -15),
    paidAt: addDays(now, -10),
    amountPaid: pounds(1800),
    notes: "Paid demo invoice.",
    items: [
      { description: "Website care plan", quantity: 1, unitPrice: pounds(900) },
      { description: "Landing page optimisation", quantity: 1, unitPrice: pounds(600) },
    ],
  })
  const sentInvoice = await upsertInvoice({
    invoiceNumber: "INV-0002",
    clientId: northwind.id,
    status: "sent",
    issueDate: addDays(now, -7),
    dueDate: addDays(now, 23),
    sentAt: addDays(now, -7),
    notes: "Upcoming invoice for dashboard testing.",
    items: [
      { description: "Monthly bookkeeping support", quantity: 1, unitPrice: pounds(450) },
      { description: "VAT return preparation", quantity: 1, unitPrice: pounds(225) },
    ],
  })
  await upsertInvoice({
    invoiceNumber: "INV-0003",
    clientId: bright.id,
    status: "overdue",
    issueDate: addDays(now, -60),
    dueDate: addDays(now, -30),
    sentAt: addDays(now, -58),
    notes: "Overdue demo invoice.",
    items: [
      { description: "Point-of-sale setup consultation", quantity: 1, unitPrice: pounds(650) },
      { description: "Staff training session", quantity: 2, unitPrice: pounds(175) },
    ],
  })
  await upsertInvoice({
    invoiceNumber: "INV-0004",
    clientId: acme.id,
    status: "draft",
    issueDate: now,
    dueDate: addDays(now, 30),
    notes: "Draft invoice ready to edit.",
    items: [
      { description: "Discovery workshop", quantity: 1, unitPrice: pounds(500) },
      { description: "Prototype design", quantity: 1, unitPrice: pounds(750) },
    ],
  })

  await prisma.payment.deleteMany({ where: { reference: { in: ["PAY-DEMO-0001", "PAY-DEMO-0002"] } } })
  await prisma.payment.createMany({
    data: [
      {
        invoiceId: paidInvoice.id,
        clientId: acme.id,
        amount: pounds(1800),
        date: addDays(now, -10),
        method: "bank_transfer",
        reference: "PAY-DEMO-0001",
        notes: "Full payment for demo invoice.",
      },
      {
        invoiceId: sentInvoice.id,
        clientId: northwind.id,
        amount: pounds(120),
        date: addDays(now, -2),
        method: "card",
        reference: "PAY-DEMO-0002",
        notes: "Standalone payment sample.",
      },
    ],
  })

  const softwareCategory = await prisma.expenseCategory.findUniqueOrThrow({ where: { name: "Software & Subscriptions" } })
  const travelCategory = await prisma.expenseCategory.findUniqueOrThrow({ where: { name: "Travel & Transport" } })
  const officeCategory = await prisma.expenseCategory.findUniqueOrThrow({ where: { name: "Office Supplies" } })

  await prisma.expense.deleteMany({ where: { reference: { in: ["EXP-DEMO-0001", "EXP-DEMO-0002", "EXP-DEMO-0003"] } } })
  await prisma.expense.createMany({
    data: [
      {
        categoryId: softwareCategory.id,
        date: addDays(now, -6),
        supplier: "Demo SaaS Co",
        description: "Accounting software subscription",
        netAmount: pounds(39),
        vatAmount: pounds(7.8),
        grossAmount: pounds(46.8),
        vatRate: 20,
        paymentMethod: "card",
        reference: "EXP-DEMO-0001",
      },
      {
        categoryId: travelCategory.id,
        clientId: acme.id,
        date: addDays(now, -14),
        supplier: "Example Rail",
        description: "Client meeting train fare",
        netAmount: pounds(84),
        vatAmount: pounds(0),
        grossAmount: pounds(84),
        vatRate: 0,
        paymentMethod: "card",
        reference: "EXP-DEMO-0002",
        isBillable: true,
      },
      {
        categoryId: officeCategory.id,
        date: addDays(now, -3),
        supplier: "Office Demo Supplies",
        description: "Printer paper and envelopes",
        netAmount: pounds(26.5),
        vatAmount: pounds(5.3),
        grossAmount: pounds(31.8),
        vatRate: 20,
        paymentMethod: "bank_transfer",
        reference: "EXP-DEMO-0003",
      },
    ],
  })

  const existingMileage = await prisma.mileageExpense.findFirst({ where: { description: "Demo: Client workshop travel" } })
  const mileageData = {
    date: addDays(now, -12),
    description: "Demo: Client workshop travel",
    startLocation: "Manchester",
    endLocation: "Leeds",
    miles: 44,
    ratePerMile: 0.45,
    amount: pounds(19.8),
    vehicleReg: "DEMO123",
    clientId: bright.id,
    isBillable: true,
  }
  if (existingMileage) await prisma.mileageExpense.update({ where: { id: existingMileage.id }, data: mileageData })
  else await prisma.mileageExpense.create({ data: mileageData })

  const quoteItems: InvoiceItemSeed[] = [
    { description: "CRM migration planning", quantity: 1, unitPrice: pounds(950) },
    { description: "Data clean-up and import", quantity: 1, unitPrice: pounds(1250) },
  ]
  const quoteTotals = getInvoiceTotals(quoteItems)
  const existingQuote = await prisma.quote.findUnique({ where: { quoteNumber: "INV-Q0001" } })
  if (existingQuote) {
    await prisma.quote.update({
      where: { quoteNumber: "INV-Q0001" },
      data: {
        clientId: northwind.id,
        status: "sent",
        issueDate: addDays(now, -4),
        expiryDate: addDays(now, 26),
        subtotal: quoteTotals.subtotal,
        vatTotal: quoteTotals.vatTotal,
        total: quoteTotals.total,
        notes: "Demo quote awaiting approval.",
        items: {
          deleteMany: {},
          create: getInvoiceItemData(quoteItems),
        },
      },
    })
  } else {
    await prisma.quote.create({
      data: {
        quoteNumber: "INV-Q0001",
        clientId: northwind.id,
        status: "sent",
        issueDate: addDays(now, -4),
        expiryDate: addDays(now, 26),
        subtotal: quoteTotals.subtotal,
        vatTotal: quoteTotals.vatTotal,
        total: quoteTotals.total,
        notes: "Demo quote awaiting approval.",
        items: {
          create: getInvoiceItemData(quoteItems),
        },
      },
    })
  }

  const existingRecurring = await prisma.recurringInvoice.findFirst({ where: { templateName: "Demo monthly support retainer" } })
  const recurringData = {
    templateName: "Demo monthly support retainer",
    clientId: acme.id,
    frequency: "monthly",
    startDate: addDays(now, -90),
    nextIssueDate: addDays(now, 8),
    dayOfMonth: 10,
    isActive: true,
    subtotal: pounds(750),
    vatTotal: pounds(150),
    total: pounds(900),
    notes: "Monthly retained support.",
  }
  if (existingRecurring) {
    await prisma.recurringInvoice.update({
      where: { id: existingRecurring.id },
      data: {
        ...recurringData,
        items: {
          deleteMany: {},
          create: [{ description: "Monthly retained support", quantity: 1, unitPrice: pounds(750), vatRate: 20 }],
        },
      },
    })
  } else {
    await prisma.recurringInvoice.create({
      data: {
        ...recurringData,
        items: {
          create: [{ description: "Monthly retained support", quantity: 1, unitPrice: pounds(750), vatRate: 20 }],
        },
      },
    })
  }

  const existingImport = await prisma.bankImport.findFirst({ where: { fileName: "demo-bank-import.csv" } })
  if (existingImport) {
    await prisma.bankImport.update({
      where: { id: existingImport.id },
      data: {
        rowCount: 3,
        matchedCount: 1,
        ignoredCount: 0,
        duplicateCount: 0,
        notes: "Synthetic bank import for local testing.",
        transactions: {
          deleteMany: {},
          create: [
            { date: addDays(now, -10), description: "ACME STUDIO PAYMENT", reference: "PAY-DEMO-0001", amount: pounds(1800), type: "credit", status: "matched" },
            { date: addDays(now, -6), description: "DEMO SAAS CO", reference: "EXP-DEMO-0001", amount: -pounds(46.8), type: "debit", status: "pending" },
            { date: addDays(now, -3), description: "OFFICE DEMO SUPPLIES", reference: "EXP-DEMO-0003", amount: -pounds(31.8), type: "debit", status: "pending" },
          ],
        },
      },
    })
  } else {
    await prisma.bankImport.create({
      data: {
        fileName: "demo-bank-import.csv",
        rowCount: 3,
        matchedCount: 1,
        ignoredCount: 0,
        duplicateCount: 0,
        notes: "Synthetic bank import for local testing.",
        transactions: {
          create: [
            { date: addDays(now, -10), description: "ACME STUDIO PAYMENT", reference: "PAY-DEMO-0001", amount: pounds(1800), type: "credit", status: "matched" },
            { date: addDays(now, -6), description: "DEMO SAAS CO", reference: "EXP-DEMO-0001", amount: -pounds(46.8), type: "debit", status: "pending" },
            { date: addDays(now, -3), description: "OFFICE DEMO SUPPLIES", reference: "EXP-DEMO-0003", amount: -pounds(31.8), type: "debit", status: "pending" },
          ],
        },
      },
    })
  }

  console.log("Seeded demo clients, invoices, expenses, payments, quotes, mileage, recurring invoices, and bank imports")
}

async function main() {
  await seedCoreData()
  if (process.argv.includes("--demo")) await seedDemoData()
  else console.log("Skipped demo data. Run npm run db:seed:demo to add placeholder records.")
}

main().catch(e => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
