-- Ensure IdempotencyKey table exists in legacy production databases.
-- Safe migration: uses IF NOT EXISTS and does not modify existing data.

CREATE TABLE IF NOT EXISTS "IdempotencyKey" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestPath" TEXT NOT NULL,
  "requestMethod" TEXT NOT NULL,
  "responseStatus" INTEGER NOT NULL,
  "responseBody" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyKey_key_tenantId_key"
  ON "IdempotencyKey"("key", "tenantId");

CREATE INDEX IF NOT EXISTS "IdempotencyKey_expiresAt_idx"
  ON "IdempotencyKey"("expiresAt");

CREATE INDEX IF NOT EXISTS "IdempotencyKey_tenantId_createdAt_idx"
  ON "IdempotencyKey"("tenantId", "createdAt");
