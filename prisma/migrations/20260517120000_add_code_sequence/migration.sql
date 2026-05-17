-- CreateTable
CREATE TABLE IF NOT EXISTS "CodeSequence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CodeSequence_tenantId_entityKey_year_key" ON "CodeSequence"("tenantId", "entityKey", "year");
CREATE INDEX IF NOT EXISTS "CodeSequence_tenantId_idx" ON "CodeSequence"("tenantId");
CREATE INDEX IF NOT EXISTS "CodeSequence_entityKey_idx" ON "CodeSequence"("entityKey");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CodeSequence" ADD CONSTRAINT "CodeSequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
