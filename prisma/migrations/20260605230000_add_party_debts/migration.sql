ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "openingBalanceType" TEXT,
  ADD COLUMN IF NOT EXISTS "openingBalanceAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "openingBalanceDate" TIMESTAMP(3);

ALTER TABLE "Supplier"
  ADD COLUMN IF NOT EXISTS "openingBalanceType" TEXT,
  ADD COLUMN IF NOT EXISTS "openingBalanceAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "openingBalanceDate" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "PartyDebtTransaction" (
  "id" TEXT NOT NULL,
  "partyType" TEXT NOT NULL,
  "customerId" TEXT,
  "supplierId" TEXT,
  "transactionType" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cashboxId" TEXT,
  "notes" TEXT,
  "journalEntryId" TEXT,
  "createdBy" TEXT,
  "tenantId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartyDebtTransaction_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PartyDebtTransaction_customerId_fkey'
  ) THEN
    ALTER TABLE "PartyDebtTransaction"
      ADD CONSTRAINT "PartyDebtTransaction_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PartyDebtTransaction_supplierId_fkey'
  ) THEN
    ALTER TABLE "PartyDebtTransaction"
      ADD CONSTRAINT "PartyDebtTransaction_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PartyDebtTransaction_tenantId_fkey'
  ) THEN
    ALTER TABLE "PartyDebtTransaction"
      ADD CONSTRAINT "PartyDebtTransaction_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "PartyDebtTransaction_tenantId_idx" ON "PartyDebtTransaction"("tenantId");
CREATE INDEX IF NOT EXISTS "PartyDebtTransaction_partyType_idx" ON "PartyDebtTransaction"("partyType");
CREATE INDEX IF NOT EXISTS "PartyDebtTransaction_customerId_idx" ON "PartyDebtTransaction"("customerId");
CREATE INDEX IF NOT EXISTS "PartyDebtTransaction_supplierId_idx" ON "PartyDebtTransaction"("supplierId");
CREATE INDEX IF NOT EXISTS "PartyDebtTransaction_transactionType_idx" ON "PartyDebtTransaction"("transactionType");
CREATE INDEX IF NOT EXISTS "PartyDebtTransaction_date_idx" ON "PartyDebtTransaction"("date");
CREATE INDEX IF NOT EXISTS "PartyDebtTransaction_cashboxId_idx" ON "PartyDebtTransaction"("cashboxId");
