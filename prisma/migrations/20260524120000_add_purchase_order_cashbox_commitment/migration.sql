-- Add optional treasury commitment cashbox to Purchase Orders
-- This does NOT affect actual cashbox balance; it is used for commitments/forecasting only.

ALTER TABLE "PurchaseOrder" ADD COLUMN "cashboxId" TEXT;

CREATE INDEX "PurchaseOrder_cashboxId_idx" ON "PurchaseOrder"("cashboxId");

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_cashboxId_fkey"
  FOREIGN KEY ("cashboxId") REFERENCES "Cashbox"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

