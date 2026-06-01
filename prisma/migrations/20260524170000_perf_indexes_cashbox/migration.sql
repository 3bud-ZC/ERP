-- Performance indexes for treasury/cashbox + PO commitments

-- CreateIndex
CREATE INDEX "CashboxTransaction_tenantId_date_idx"
ON "CashboxTransaction" ("tenantId", "date");

-- CreateIndex
CREATE INDEX "CashboxTransaction_tenantId_cashboxId_date_idx"
ON "CashboxTransaction" ("tenantId", "cashboxId", "date");

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_cashboxId_status_idx"
ON "PurchaseOrder" ("tenantId", "cashboxId", "status");

