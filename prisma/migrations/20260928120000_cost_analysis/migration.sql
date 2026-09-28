CREATE TABLE "InvoiceCostAssociation" (
 "invoiceId" TEXT PRIMARY KEY REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "projectId" TEXT NOT NULL REFERENCES "CostProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "periodStart" DATE NOT NULL, "periodEnd" DATE NOT NULL, "note" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "InvoiceCostAssociation_period_check" CHECK ("periodEnd" >= "periodStart")
);
CREATE INDEX "InvoiceCostAssociation_projectId_periodStart_periodEnd_idx" ON "InvoiceCostAssociation"("projectId","periodStart","periodEnd");
CREATE TABLE "CostExpenseAllocation" (
 "id" TEXT PRIMARY KEY, "expenseId" TEXT NOT NULL REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "projectId" TEXT NOT NULL REFERENCES "CostProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "amountPence" INTEGER NOT NULL, "kind" TEXT NOT NULL, "periodStart" DATE NOT NULL, "periodEnd" DATE NOT NULL,
 "note" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "CostExpenseAllocation_period_check" CHECK ("periodEnd" >= "periodStart"),
 CONSTRAINT "CostExpenseAllocation_kind_check" CHECK ("kind" IN ('direct','subscription'))
);
CREATE UNIQUE INDEX "CostExpenseAllocation_expenseId_projectId_key" ON "CostExpenseAllocation"("expenseId","projectId");
CREATE INDEX "CostExpenseAllocation_projectId_periodStart_periodEnd_idx" ON "CostExpenseAllocation"("projectId","periodStart","periodEnd");
CREATE TABLE "CostFxRate" (
 "id" TEXT PRIMARY KEY, "currency" TEXT NOT NULL, "date" DATE NOT NULL,
 "gbpRate" DECIMAL(20,8) NOT NULL, "source" TEXT NOT NULL, "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CostFxRate_currency_date_key" ON "CostFxRate"("currency","date");
