-- Approved client-charge snapshots. This migration is not applied to production by the shadow comparison.
-- Corrections append a new row through replacesSnapshotId. Application code must not update these rows.
CREATE TABLE "CostChargeSnapshot" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "projectId" TEXT NOT NULL REFERENCES "CostProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "policyVersion" TEXT NOT NULL,
 "allocationMethod" TEXT,
 "sourceRevisionIds" JSONB NOT NULL,
 "currency" TEXT NOT NULL,
 "fxSource" TEXT,
 "fxDate" DATE,
 "fxRate" DECIMAL(20,8),
 "usageValueUnits" BIGINT,
 "providerCostUnits" BIGINT,
 "clientChargePence" INTEGER NOT NULL,
 "outstandingPence" INTEGER,
 "verificationStatus" TEXT NOT NULL,
 "invoiceId" TEXT REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "paymentId" TEXT REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "replacesSnapshotId" TEXT REFERENCES "CostChargeSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "evidence" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CostChargeSnapshot_status_check" CHECK ("verificationStatus" = 'approved'),
 CONSTRAINT "CostChargeSnapshot_currency_check" CHECK ("currency" IN ('USD','GBP','EUR'))
);
CREATE INDEX "CostChargeSnapshot_projectId_createdAt_idx" ON "CostChargeSnapshot"("projectId","createdAt");
CREATE INDEX "CostChargeSnapshot_invoiceId_idx" ON "CostChargeSnapshot"("invoiceId");
CREATE INDEX "CostChargeSnapshot_paymentId_idx" ON "CostChargeSnapshot"("paymentId");
