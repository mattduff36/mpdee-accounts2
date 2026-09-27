-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "viewHidden" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Invoice_viewHidden_idx" ON "Invoice"("viewHidden");
