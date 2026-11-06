CREATE TABLE "CostCustomRecurring" (
  "id" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "importChecksum" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "recurrence" TEXT NOT NULL DEFAULT 'monthly',
  "effectiveStart" DATE NOT NULL,
  "effectiveEnd" DATE,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CostCustomRecurring_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CostCustomRecurring_amount" CHECK ("amountMinor" BETWEEN 0 AND 2000000000),
  CONSTRAINT "CostCustomRecurring_currency" CHECK ("currency" IN ('GBP', 'USD', 'EUR')),
  CONSTRAINT "CostCustomRecurring_monthly" CHECK ("recurrence" = 'monthly'),
  CONSTRAINT "CostCustomRecurring_dates" CHECK ("effectiveEnd" IS NULL OR "effectiveEnd" > "effectiveStart"),
  CONSTRAINT "CostCustomRecurring_revision" CHECK ("revision" > 0),
  CONSTRAINT "CostCustomRecurring_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CostProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CostCustomRecurring_sourceKey_key" ON "CostCustomRecurring"("sourceKey");
CREATE INDEX "CostCustomRecurring_projectId_active_idx" ON "CostCustomRecurring"("projectId", "active");

CREATE TABLE "CostCustomRecurringRevision" (
  "id" TEXT NOT NULL,
  "recurringId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostCustomRecurringRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CostCustomRecurringRevision_actor" CHECK (("actorType" = 'machine' AND "actorId" IS NULL) OR ("actorType" = 'user' AND "actorId" IS NOT NULL)),
  CONSTRAINT "CostCustomRecurringRevision_revision" CHECK ("revision" > 0),
  CONSTRAINT "CostCustomRecurringRevision_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "CostCustomRecurring"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CostCustomRecurringRevision_recurringId_revision_key" ON "CostCustomRecurringRevision"("recurringId", "revision");
