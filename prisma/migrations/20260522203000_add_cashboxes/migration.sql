-- Add tenant-scoped cashboxes and cashbox ledger transactions.
CREATE TABLE "Cashbox" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cashbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CashboxTransaction" (
    "id" TEXT NOT NULL,
    "cashboxId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "description" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashboxTransaction_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Payment" ADD COLUMN "cashboxId" TEXT;
ALTER TABLE "Expense" ADD COLUMN "cashboxId" TEXT;

CREATE UNIQUE INDEX "Cashbox_code_key" ON "Cashbox"("code");
CREATE INDEX "Cashbox_tenantId_idx" ON "Cashbox"("tenantId");
CREATE INDEX "Cashbox_status_idx" ON "Cashbox"("status");
CREATE INDEX "CashboxTransaction_tenantId_idx" ON "CashboxTransaction"("tenantId");
CREATE INDEX "CashboxTransaction_cashboxId_idx" ON "CashboxTransaction"("cashboxId");
CREATE INDEX "CashboxTransaction_date_idx" ON "CashboxTransaction"("date");
CREATE INDEX "CashboxTransaction_referenceType_referenceId_idx" ON "CashboxTransaction"("referenceType", "referenceId");
CREATE INDEX "Payment_cashboxId_idx" ON "Payment"("cashboxId");
CREATE INDEX "Expense_cashboxId_idx" ON "Expense"("cashboxId");

ALTER TABLE "Cashbox" ADD CONSTRAINT "Cashbox_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashboxTransaction" ADD CONSTRAINT "CashboxTransaction_cashboxId_fkey" FOREIGN KEY ("cashboxId") REFERENCES "Cashbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashboxTransaction" ADD CONSTRAINT "CashboxTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cashboxId_fkey" FOREIGN KEY ("cashboxId") REFERENCES "Cashbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_cashboxId_fkey" FOREIGN KEY ("cashboxId") REFERENCES "Cashbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
