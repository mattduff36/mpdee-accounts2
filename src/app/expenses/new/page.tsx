import { prisma } from "@/lib/db"
import { requireWrite } from "@/lib/auth"
import { PageHeader } from "@/components/PageHeader"
import { ExpenseForm } from "./ExpenseForm"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { ExpenseFormValidationError, parseExpenseForm, type ExpenseFormActionState } from "@/lib/expense-form"

export default async function NewExpensePage() {
  await requireWrite()
  const categories = await prisma.expenseCategory.findMany({ where: { isArchived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } })
  const clients = await prisma.client.findMany({ where: { isArchived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } })
  async function createExpenseAction(_previous: ExpenseFormActionState, formData: FormData): Promise<ExpenseFormActionState> {
    "use server"
    await requireWrite()
    const valueLimits: Record<string, number> = { categoryId: 100, date: 10, supplier: 200, description: 500, netAmount: 40, vatRate: 3, paymentMethod: 40, reference: 200, clientId: 100, notes: 2000, isReimbursable: 3, isBillable: 3 }
    const values = Object.fromEntries(Object.entries(valueLimits).map(([field, limit]) => {
      const value = formData.get(field)
      return [field, typeof value === "string" ? value.slice(0, limit) : ""]
    }))
    let expense
    try {
      expense = parseExpenseForm({
        categoryId: formData.get("categoryId"), clientId: formData.get("clientId"), date: formData.get("date"),
        supplier: formData.get("supplier"), description: formData.get("description"), netAmount: formData.get("netAmount"),
        vatRate: formData.get("vatRate"), paymentMethod: formData.get("paymentMethod"), reference: formData.get("reference"),
        notes: formData.get("notes"), isReimbursable: formData.get("isReimbursable"), isBillable: formData.get("isBillable"),
      })
    } catch (error) {
      if (error instanceof ExpenseFormValidationError) return { errors: { [error.field]: error.message }, values }
      throw error
    }

    const [category, client] = await Promise.all([
      prisma.expenseCategory.findFirst({ where: { id: expense.categoryId, isArchived: false }, select: { id: true } }),
      expense.clientId ? prisma.client.findFirst({ where: { id: expense.clientId, isArchived: false }, select: { id: true } }) : Promise.resolve(null),
    ])
    const errors: Record<string, string> = {}
    if (!category) errors.categoryId = "Choose an active expense category."
    if (expense.clientId && !client) errors.clientId = "Choose an active client or select None."
    if (Object.keys(errors).length) return { errors, values }

    await prisma.expense.create({ data: expense })
    revalidatePath("/expenses")
    redirect("/expenses")
  }
  return <div className="max-w-2xl space-y-6">
    <PageHeader title="New expense" description="Record a business cost and keep its supporting reference." />
    <ExpenseForm action={createExpenseAction} categories={categories} clients={clients} />
  </div>
}
