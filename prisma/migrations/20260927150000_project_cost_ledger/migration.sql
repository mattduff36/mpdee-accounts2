-- CreateTable
CREATE TABLE "CostProject" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT,
    "repository" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostProjectMapping" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "CostProjectMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostPolicy" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "projectId" TEXT,
    "clientId" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "includedBaseBps" INTEGER NOT NULL DEFAULT 5000,
    "markupBps" INTEGER NOT NULL DEFAULT 0,
    "infrastructureMarkupBps" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostUsageEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountRef" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT,
    "attribution" TEXT NOT NULL DEFAULT 'unassigned',
    "manualAssignment" BOOLEAN NOT NULL DEFAULT false,
    "workspaceRef" TEXT,
    "conversationId" TEXT,
    "resourceRef" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostUsageRevision" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "funding" TEXT NOT NULL,
    "nominalUnits" BIGINT,
    "providerUnits" BIGINT,
    "currency" TEXT NOT NULL,
    "fxGbp" DECIMAL(20,8),
    "quality" TEXT NOT NULL,
    "reason" TEXT,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostUsageRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostImportRun" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountRef" TEXT NOT NULL,
    "received" INTEGER NOT NULL,
    "added" INTEGER NOT NULL,
    "revised" INTEGER NOT NULL,
    "duplicate" INTEGER NOT NULL,
    "unassigned" INTEGER NOT NULL,
    "quality" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CostProject_slug_key" ON "CostProject"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CostProjectMapping_type_value_key" ON "CostProjectMapping"("type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "CostPolicy_scopeKey_effectiveAt_key" ON "CostPolicy"("scopeKey", "effectiveAt");

-- CreateIndex
CREATE INDEX "CostUsageEvent_projectId_occurredAt_idx" ON "CostUsageEvent"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "CostUsageEvent_occurredAt_idx" ON "CostUsageEvent"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CostUsageEvent_provider_accountRef_sourceKey_key" ON "CostUsageEvent"("provider", "accountRef", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "CostUsageRevision_eventId_revision_key" ON "CostUsageRevision"("eventId", "revision");

-- AddForeignKey
ALTER TABLE "CostProject" ADD CONSTRAINT "CostProject_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostProjectMapping" ADD CONSTRAINT "CostProjectMapping_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CostProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostPolicy" ADD CONSTRAINT "CostPolicy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CostProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostPolicy" ADD CONSTRAINT "CostPolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostUsageEvent" ADD CONSTRAINT "CostUsageEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CostProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostUsageRevision" ADD CONSTRAINT "CostUsageRevision_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CostUsageEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Keep policy scope and percentages valid even outside the application.
ALTER TABLE "CostPolicy" ADD CONSTRAINT "CostPolicy_scope_check" CHECK (
  ("projectId" IS NOT NULL AND "clientId" IS NULL AND "scopeKey" = 'project:' || "projectId") OR
  ("projectId" IS NULL AND "clientId" IS NOT NULL AND "scopeKey" = 'client:' || "clientId")
);
ALTER TABLE "CostPolicy" ADD CONSTRAINT "CostPolicy_percent_check" CHECK (
  "includedBaseBps" BETWEEN 0 AND 10000 AND "markupBps" BETWEEN 0 AND 100000 AND "infrastructureMarkupBps" BETWEEN 0 AND 100000
);
ALTER TABLE "CostUsageRevision" ADD CONSTRAINT "CostUsageRevision_fx_check" CHECK ("fxGbp" IS NULL OR "fxGbp" > 0);
