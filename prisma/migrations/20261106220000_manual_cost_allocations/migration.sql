CREATE TABLE "CostManualAllocation" (
  "id" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "subscriptionInvoiceId" TEXT,
  "recurringId" TEXT,
  "revision" INTEGER NOT NULL,
  CONSTRAINT "CostManualAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CostManualAllocation_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "CostManualAllocation_source_check" CHECK (
    ("sourceKind" = 'subscription_invoice' AND "subscriptionInvoiceId" IS NOT NULL
      AND "sourceId" = "subscriptionInvoiceId" AND "recurringId" IS NULL)
    OR ("sourceKind" = 'custom_recurring' AND "recurringId" IS NOT NULL
      AND "sourceId" = "recurringId" AND "subscriptionInvoiceId" IS NULL)
  )
);
CREATE TABLE "CostManualAllocationRevision" (
  "id" TEXT NOT NULL,
  "allocationId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "version" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "basis" TEXT NOT NULL DEFAULT 'user_selected',
  "unallocatedBps" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostManualAllocationRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CostManualAllocationRevision_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "CostManualAllocationRevision_version_check" CHECK ("version" = 'mpdee-manual-allocation-v1'),
  CONSTRAINT "CostManualAllocationRevision_basis_check" CHECK ("basis" = 'user_selected'),
  CONSTRAINT "CostManualAllocationRevision_remainder_check" CHECK ("unallocatedBps" BETWEEN 0 AND 10000)
);
CREATE TABLE "CostManualAllocationShare" (
  "id" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "shareBps" INTEGER NOT NULL,
  CONSTRAINT "CostManualAllocationShare_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CostManualAllocationShare_bps_check" CHECK ("shareBps" BETWEEN 1 AND 10000)
);
CREATE UNIQUE INDEX "CostManualAllocation_sourceKind_sourceId_key" ON "CostManualAllocation"("sourceKind", "sourceId");
CREATE UNIQUE INDEX "CostManualAllocation_subscriptionInvoiceId_key" ON "CostManualAllocation"("subscriptionInvoiceId");
CREATE UNIQUE INDEX "CostManualAllocation_recurringId_key" ON "CostManualAllocation"("recurringId");
CREATE UNIQUE INDEX "CostManualAllocationRevision_allocationId_revision_key" ON "CostManualAllocationRevision"("allocationId", "revision");
CREATE UNIQUE INDEX "CostManualAllocationShare_revisionId_projectId_key" ON "CostManualAllocationShare"("revisionId", "projectId");
ALTER TABLE "CostManualAllocation" ADD CONSTRAINT "CostManualAllocation_subscriptionInvoiceId_fkey" FOREIGN KEY ("subscriptionInvoiceId") REFERENCES "CostSubscriptionInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostManualAllocation" ADD CONSTRAINT "CostManualAllocation_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "CostCustomRecurring"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostManualAllocationRevision" ADD CONSTRAINT "CostManualAllocationRevision_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "CostManualAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostManualAllocationShare" ADD CONSTRAINT "CostManualAllocationShare_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "CostManualAllocationRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CostManualAllocationShare" ADD CONSTRAINT "CostManualAllocationShare_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CostProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
