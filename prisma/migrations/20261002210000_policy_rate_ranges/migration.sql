-- Editable from/to charging ranges and a daily Vercel membership amount in pence.
ALTER TABLE "CostPolicy" ADD COLUMN "effectiveUntil" TIMESTAMP(3);
ALTER TABLE "CostPolicy" ADD COLUMN "vercelDailyPence" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CostPolicy" ADD CONSTRAINT "CostPolicy_range_check" CHECK ("effectiveUntil" IS NULL OR "effectiveUntil" >= "effectiveAt");
ALTER TABLE "CostPolicy" ADD CONSTRAINT "CostPolicy_vercel_daily_check" CHECK ("vercelDailyPence" >= 0 AND "vercelDailyPence" <= 10000000);

UPDATE "CostPolicy" AS policy
SET "vercelDailyPence" = 38
FROM "CostProject" AS project
WHERE policy."projectId" = project."id" AND project."slug" = 'itrader';
