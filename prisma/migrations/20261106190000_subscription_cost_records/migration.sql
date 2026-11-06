CREATE TABLE "CostSubscriptionInvoice" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "accountRef" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "netMinor" INTEGER NOT NULL,
  "taxMinor" INTEGER NOT NULL,
  "grossMinor" INTEGER NOT NULL,
  "invoiceDate" DATE NOT NULL,
  "paymentDate" DATE NOT NULL,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "gbpEstimatePence" INTEGER NOT NULL,
  "fxRate" DECIMAL(30,16) NOT NULL,
  "fxDate" DATE NOT NULL,
  "fxSource" TEXT NOT NULL,
  "allocationStatus" TEXT NOT NULL DEFAULT 'unallocated',
  "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostSubscriptionInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CostSubscriptionInvoice_amounts" CHECK ("netMinor">=0 AND "taxMinor">=0 AND "grossMinor"="netMinor"+"taxMinor" AND "gbpEstimatePence">=0 AND "fxRate">0),
  CONSTRAINT "CostSubscriptionInvoice_period" CHECK ("periodEnd">"periodStart"),
  CONSTRAINT "CostSubscriptionInvoice_unallocated" CHECK ("allocationStatus"='unallocated')
);
CREATE UNIQUE INDEX "CostSubscriptionInvoice_provider_accountRef_invoiceNumber_key" ON "CostSubscriptionInvoice"("provider","accountRef","invoiceNumber");
CREATE INDEX "CostSubscriptionInvoice_periodStart_periodEnd_idx" ON "CostSubscriptionInvoice"("periodStart","periodEnd");
