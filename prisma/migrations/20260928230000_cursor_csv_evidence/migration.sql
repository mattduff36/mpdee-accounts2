-- Evidence only: no existing ledger or accounting tables are modified.
CREATE TABLE "CostUsageEvidence" (
  "id" TEXT NOT NULL,
  "accountEmail" TEXT NOT NULL,
  "accountRef" TEXT,
  "fingerprint" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "model" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "inputTokens" BIGINT,
  "cacheWriteTokens" BIGINT,
  "cacheReadTokens" BIGINT,
  "outputTokens" BIGINT,
  "totalTokens" BIGINT,
  "evidence" JSONB NOT NULL,
  "sourceFile" TEXT NOT NULL,
  "sourceSha256" TEXT NOT NULL,
  "linkedEventId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostUsageEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CostUsageEvidence_known_account" CHECK ("accountEmail" IN ('admin@mpdee.co.uk','mattduff36@gmail.com','matt.mpdee@gmail.com','mattduff36@hotmail.com')),
  CONSTRAINT "CostUsageEvidence_linkedEventId_fkey" FOREIGN KEY ("linkedEventId") REFERENCES "CostUsageEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CostUsageEvidence_accountEmail_fingerprint_key" ON "CostUsageEvidence"("accountEmail", "fingerprint");
CREATE INDEX "CostUsageEvidence_accountEmail_occurredAt_idx" ON "CostUsageEvidence"("accountEmail", "occurredAt");
CREATE INDEX "CostUsageEvidence_linkedEventId_idx" ON "CostUsageEvidence"("linkedEventId");
