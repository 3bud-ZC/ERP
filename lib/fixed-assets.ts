const FIXED_ASSET_NUMBER_PREFIX = 'FA-';

export function parseFixedAssetSequence(assetNumber?: string | null): number {
  const normalized = String(assetNumber || '').trim().toUpperCase();
  if (!normalized.startsWith(FIXED_ASSET_NUMBER_PREFIX)) return 0;

  const nextValue = Number.parseInt(normalized.slice(FIXED_ASSET_NUMBER_PREFIX.length), 10);
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 0;
}

export function getNextFixedAssetNumber(lastAssetNumber?: string | null): string {
  const nextValue = parseFixedAssetSequence(lastAssetNumber) + 1;
  return `${FIXED_ASSET_NUMBER_PREFIX}${String(nextValue).padStart(6, '0')}`;
}
