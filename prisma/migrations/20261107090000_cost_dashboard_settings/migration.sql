CREATE TABLE "CostDashboardSettings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "data" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CostDashboardSettings_pkey" PRIMARY KEY ("id")
);
