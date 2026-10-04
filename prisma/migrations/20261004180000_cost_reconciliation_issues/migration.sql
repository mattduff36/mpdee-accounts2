-- Local reconciliation workflow. Status changes do not alter usage, expenses, or approved snapshots.
ALTER TABLE "Expense" ADD COLUMN "providerAccountRef" TEXT;
ALTER TABLE "Expense" ADD COLUMN "serviceName" TEXT;
ALTER TABLE "Expense" ADD COLUMN "billingPeriodStart" DATE;
ALTER TABLE "Expense" ADD COLUMN "billingPeriodEnd" DATE;

CREATE TABLE "CostReconciliationIssue" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "stableKey" TEXT NOT NULL,
  "projectSlug" TEXT,
  "provider" TEXT,
  "accountRef" TEXT,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "evidenceRef" TEXT NOT NULL,
  "amountText" TEXT,
  "currency" TEXT,
  "amountUnknown" BOOLEAN NOT NULL DEFAULT false,
  "effectOnTotals" TEXT NOT NULL,
  "billingEffect" TEXT NOT NULL,
  "requiredAction" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "resolutionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostReconciliationIssue_status_check" CHECK ("status" IN ('open', 'reviewed', 'resolved'))
);
CREATE UNIQUE INDEX "CostReconciliationIssue_stableKey_key" ON "CostReconciliationIssue"("stableKey");

CREATE TABLE "CostReconciliationEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "issueId" TEXT NOT NULL REFERENCES "CostReconciliationIssue"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "action" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "actorEmail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CostReconciliationEvent_issueId_createdAt_idx" ON "CostReconciliationEvent"("issueId", "createdAt");

CREATE TABLE "CostRefreshStatus" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "finishedAt" TIMESTAMP(3) NOT NULL,
  "sourceNote" TEXT NOT NULL,
  "added" INTEGER NOT NULL,
  "duplicate" INTEGER NOT NULL,
  "unavailableNote" TEXT NOT NULL
);
