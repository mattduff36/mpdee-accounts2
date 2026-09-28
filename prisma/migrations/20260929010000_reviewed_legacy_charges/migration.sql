-- Frozen reviewed client balances; separate from provider usage and expenses.
CREATE TABLE "CostLegacyCharge" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "projectId" TEXT NOT NULL REFERENCES "CostProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "sourceSystem" TEXT NOT NULL, "sourceDatabaseFingerprint" TEXT NOT NULL,
 "sourceKind" TEXT NOT NULL, "sourceBucket" TEXT NOT NULL,
 "sourceRevision" INTEGER NOT NULL, "sourceChecksum" TEXT NOT NULL,
 "category" TEXT NOT NULL,
 "periodStart" TIMESTAMPTZ(3) NOT NULL, "periodEnd" TIMESTAMPTZ(3) NOT NULL,
 "label" TEXT NOT NULL, "frozenGbpPence" INTEGER NOT NULL,
 "invoiceability" TEXT NOT NULL, "sourceEvidence" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CostLegacyCharge_period_check" CHECK ("periodEnd" > "periodStart"),
 CONSTRAINT "CostLegacyCharge_revision_check" CHECK ("sourceRevision" >= 1),
 CONSTRAINT "CostLegacyCharge_invoiceability_check" CHECK ("invoiceability" IN ('INVOICEABLE','PROVISIONAL')),
 CONSTRAINT "CostLegacyCharge_category_check" CHECK ("category" IN ('CURSOR','VERCEL_HOSTING','DATABASE','SHARED_VERCEL','OTHER'))
);
CREATE UNIQUE INDEX "CostLegacyCharge_source_identity_key" ON "CostLegacyCharge"("sourceSystem","sourceDatabaseFingerprint","sourceKind","sourceBucket");
CREATE INDEX "CostLegacyCharge_projectId_periodStart_periodEnd_idx" ON "CostLegacyCharge"("projectId","periodStart","periodEnd");
