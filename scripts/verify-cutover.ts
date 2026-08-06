import fs from "fs"
import { PrismaClient } from "@prisma/client"
import { generateInvoicePDF } from "../src/lib/pdf"
import { allocateInvoiceNumber } from "../src/lib/invoice-number"
import { sendInvoiceEmail } from "../src/lib/email"
import { loadLocalEnv } from "./load-env"

loadLocalEnv()

const prisma = new PrismaClient()

async function main() {
  const results: Array<[string, boolean, string]> = []

  const invCount = await prisma.invoice.count()
  const legacy = await prisma.$queryRawUnsafe<
    Array<{ n: number; total_pence: number }>
  >(`select count(*)::int as n, coalesce(round(sum(total_amount)*100)::int,0) as total_pence from invoices`)
  const prismaAgg = await prisma.invoice.aggregate({ _sum: { total: true }, _count: true })
  const latest = await prisma.invoice.findFirst({
    orderBy: { issueDate: "desc" },
    select: { invoiceNumber: true },
  })
  const withComm = await prisma.invoiceItem.count({ where: { agencyCommission: { gt: 0 } } })
  const contaminated = await prisma.invoiceItem.count({
    where: { description: { contains: "Legacy area" } },
  })
  const moneyMatch = (prismaAgg._sum.total || 0) === legacy[0].total_pence
  const dataOk =
    invCount === legacy[0].n &&
    moneyMatch &&
    latest?.invoiceNumber === "MPD-2026-043" &&
    withComm > 0 &&
    contaminated === 0
  results.push([
    "CUT-DATA-001",
    dataOk,
    `count ${invCount}/${legacy[0].n}; totals ${prismaAgg._sum.total}/${legacy[0].total_pence}; latest=${latest?.invoiceNumber}; commissionItems=${withComm}; contaminated=${contaminated}`,
  ])

  const settings = await prisma.companySettings.findUnique({ where: { id: "default" } })
  const next = await allocateInvoiceNumber(settings?.invoicePrefix || "MPD")
  results.push(["CUT-NUM-001", next === "MPD-2026-044", `next=${next}`])

  const inv = await prisma.invoice.findFirst({
    where: { items: { some: { agencyCommission: { gt: 0 } } } },
    include: { client: true, items: { orderBy: { sortOrder: "asc" } } },
    orderBy: { issueDate: "desc" },
  })
  if (!inv) throw new Error("No commission invoice found")
  const buf = await generateInvoicePDF({
    invoice: {
      invoiceNumber: inv.invoiceNumber,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      status: inv.status,
      total: inv.total,
      client: inv.client,
      items: inv.items,
    },
    company: {
      businessName: settings?.businessName || "MPDEE",
      addressLine1: settings?.addressLine1,
      bankAccountName: settings?.bankAccountName,
      bankSortCode: settings?.bankSortCode,
      bankAccountNumber: settings?.bankAccountNumber,
      bankName: settings?.bankName,
    },
  })
  const bytes = Buffer.from(buf)
  fs.mkdirSync("backups", { recursive: true })
  fs.writeFileSync(`backups/verify-${inv.invoiceNumber}.pdf`, bytes)
  results.push([
    "CUT-PDF-001",
    bytes.length > 1000 && bytes.slice(0, 4).toString() === "%PDF",
    `invoice=${inv.invoiceNumber} bytes=${bytes.length}`,
  ])

  const prevProvider = process.env.EMAIL_PROVIDER
  process.env.EMAIL_PROVIDER = "mock"
  const client = await prisma.client.findFirst({ where: { email: { not: null } } })
  if (!client?.email) throw new Error("No client email for send test")
  const number = `MPD-TEST-${Date.now().toString().slice(-6)}`
  const testInv = await prisma.invoice.create({
    data: {
      invoiceNumber: number,
      clientId: client.id,
      status: "draft",
      issueDate: new Date(),
      dueDate: new Date(),
      paymentTerms: 30,
      subtotal: 100,
      total: 100,
      balanceDue: 100,
      vatEnabled: false,
      items: {
        create: [
          {
            description: "Cutover verify item",
            quantity: 1,
            unitPrice: 100,
            lineTotal: 100,
            agencyCommission: 10,
            businessArea: "CREATIVE",
          },
        ],
      },
    },
  })
  const paidGuard = await sendInvoiceEmail(
    (
      await prisma.invoice.create({
        data: {
          invoiceNumber: `${number}-PAID`,
          clientId: client.id,
          status: "paid",
          issueDate: new Date(),
          dueDate: new Date(),
          paymentTerms: 30,
          subtotal: 50,
          total: 50,
          amountPaid: 50,
          balanceDue: 0,
          vatEnabled: false,
          items: {
            create: [{ description: "paid guard", quantity: 1, unitPrice: 50, lineTotal: 50 }],
          },
        },
      })
    ).id
  )
  const paidGuardId = (
    await prisma.invoice.findFirst({ where: { invoiceNumber: `${number}-PAID` } })
  )!.id
  const result = await sendInvoiceEmail(testInv.id)
  const after = await prisma.invoice.findUnique({ where: { id: testInv.id } })
  const sendOk = result.ok === true && after?.status === "sent" && paidGuard.ok === false
  results.push([
    "CUT-SEND-001",
    sendOk,
    `mock send ok=${result.ok}; paidGuardRejected=${!paidGuard.ok}; status=${after?.status}`,
  ])
  await prisma.emailLog.deleteMany({ where: { invoiceId: { in: [testInv.id, paidGuardId] } } })
  await prisma.invoice.deleteMany({ where: { id: { in: [testInv.id, paidGuardId] } } })
  process.env.EMAIL_PROVIDER = prevProvider

  const user = await prisma.user.findUnique({
    where: { email: "admin@mpdee.co.uk" },
    select: { email: true, isActive: true, password: true },
  })
  const { verifyPassword, createSession, getSessionUser } = await import("../src/lib/auth")
  const { cookies } = await import("next/headers")
  // Password verify only (cookie APIs need Next request context)
  const passwordOk = !!user && (await verifyPassword(process.env.ADMIN_PASSWORD || "", user.password))
  results.push([
    "CUT-LOGIN-001",
    !!user?.isActive && passwordOk,
    `user=${user?.email || "missing"} passwordOk=${passwordOk}`,
  ])

  const mw = fs.readFileSync("middleware.ts", "utf8")
  const seedRoute = fs.readFileSync("src/app/api/seed/route.ts", "utf8")
  const invApi = fs.readFileSync("src/app/api/invoices/[id]/route.ts", "utf8")
  const settingsApi = fs.readFileSync("src/app/api/settings/route.ts", "utf8")
  const secOk =
    !mw.includes("'/api/seed'") &&
    seedRoute.includes("404") &&
    invApi.includes("requireApiAuth") &&
    settingsApi.includes("requireApiAuth")
  results.push(["CUT-SEC-001", secOk, "seed locked; invoice/settings APIs require auth"])

  let all = true
  for (const [id, ok, note] of results) {
    console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${note}`)
    if (!ok) all = false
  }
  console.log(all ? "ALL_CUTOVER_CHECKS_PASSED" : "CUTOVER_CHECKS_FAILED")
  // silence unused
  void cookies
  void createSession
  void getSessionUser
  if (!all) process.exit(1)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
