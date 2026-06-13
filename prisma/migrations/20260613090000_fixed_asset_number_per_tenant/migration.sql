DROP INDEX IF EXISTS "FixedAsset_assetNumber_key";

CREATE UNIQUE INDEX "FixedAsset_tenantId_assetNumber_key"
ON "FixedAsset"("tenantId", "assetNumber");
