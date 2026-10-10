-- Expand-only current calculation settings. Does not update, backfill, or reset existing rows.
CREATE TABLE "CostCalculationSettings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "includedPremiumBps" INTEGER NOT NULL DEFAULT 5000,
  "includedGrokComposerBps" INTEGER NOT NULL DEFAULT 0,
  "onDemandBps" INTEGER NOT NULL DEFAULT 10000,
  "dailyHostingPence" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CostCalculationSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CostCalculationSettings_singleton_check" CHECK ("id" = 'global'),
  CONSTRAINT "CostCalculationSettings_rate_check" CHECK (
    "includedPremiumBps" BETWEEN 0 AND 100000
    AND "includedGrokComposerBps" BETWEEN 0 AND 100000
    AND "onDemandBps" BETWEEN 0 AND 100000
    AND "dailyHostingPence" BETWEEN 0 AND 10000000
  )
);

CREATE TABLE "CostProjectCalculationSettings" (
  "projectId" TEXT NOT NULL,
  "includedPremiumBps" INTEGER,
  "includedGrokComposerBps" INTEGER,
  "onDemandBps" INTEGER,
  "dailyHostingPence" INTEGER,
  "hostingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "hostingStartDate" DATE,
  "hostingEndDate" DATE,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CostProjectCalculationSettings_pkey" PRIMARY KEY ("projectId"),
  CONSTRAINT "CostProjectCalculationSettings_rate_check" CHECK (
    ("includedPremiumBps" IS NULL OR "includedPremiumBps" BETWEEN 0 AND 100000)
    AND ("includedGrokComposerBps" IS NULL OR "includedGrokComposerBps" BETWEEN 0 AND 100000)
    AND ("onDemandBps" IS NULL OR "onDemandBps" BETWEEN 0 AND 100000)
    AND ("dailyHostingPence" IS NULL OR "dailyHostingPence" BETWEEN 0 AND 10000000)
  ),
  CONSTRAINT "CostProjectCalculationSettings_hosting_check" CHECK (
    ("hostingEnabled" = false OR "hostingStartDate" IS NOT NULL)
    AND ("hostingEndDate" IS NULL OR ("hostingStartDate" IS NOT NULL AND "hostingEndDate" >= "hostingStartDate"))
  )
);

ALTER TABLE "CostProjectCalculationSettings" ADD CONSTRAINT "CostProjectCalculationSettings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CostProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
