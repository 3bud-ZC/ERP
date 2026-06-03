ALTER TABLE "WorkInProgress"
ADD COLUMN "cashboxId" TEXT,
ADD COLUMN "laborPaymentCategory" TEXT NOT NULL DEFAULT 'wages',
ADD COLUMN "overheadPaymentCategory" TEXT NOT NULL DEFAULT 'production_cost';

CREATE INDEX "WorkInProgress_cashboxId_idx" ON "WorkInProgress"("cashboxId");
