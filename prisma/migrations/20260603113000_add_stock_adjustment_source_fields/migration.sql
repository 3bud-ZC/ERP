ALTER TABLE "StockAdjustment"
ADD COLUMN "applyToStock" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "sourceType" TEXT,
ADD COLUMN "sourceId" TEXT;

CREATE INDEX "StockAdjustment_sourceType_sourceId_idx" ON "StockAdjustment"("sourceType", "sourceId");
