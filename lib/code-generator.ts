/**
 * Auto Code Generator Utility (legacy facade → code-sequence.service)
 */

import {
  type CodeEntityKey,
  resolveEntityCode,
  nextEntityCode,
  formatEntityCode,
  CODE_ENTITY_KEYS,
} from './code-sequence.service';

export { CODE_ENTITY_KEYS, type CodeEntityKey, formatEntityCode };

const LEGACY_ENTITY_MAP: Record<string, CodeEntityKey> = {
  product: CODE_ENTITY_KEYS.FINISHED_PRODUCT,
  raw_material: CODE_ENTITY_KEYS.RAW_MATERIAL,
  warehouse: CODE_ENTITY_KEYS.WAREHOUSE,
  customer: CODE_ENTITY_KEYS.CUSTOMER,
  supplier: CODE_ENTITY_KEYS.SUPPLIER,
  sales_order: CODE_ENTITY_KEYS.SALES_INVOICE,
  sales_invoice: CODE_ENTITY_KEYS.SALES_INVOICE,
  purchase_order: CODE_ENTITY_KEYS.PRODUCTION_ORDER,
  purchase_invoice: CODE_ENTITY_KEYS.PURCHASE_INVOICE,
};

/**
 * @deprecated Use resolveEntityCode / nextEntityCode from code-sequence.service
 */
export async function generateAutoCode(
  entityType: string,
  _existingCodes: string[] = [],
  tenantId?: string,
): Promise<string> {
  const key = LEGACY_ENTITY_MAP[entityType];
  if (!key || !tenantId) {
    const prefixes: Record<string, string> = {
      product: 'PRD',
      raw_material: 'RAW',
      warehouse: 'WRH',
      customer: 'CUS',
      supplier: 'VEN',
    };
    const prefix = prefixes[entityType] || 'CODE';
    const year = new Date().getFullYear();
    return formatEntityCode(prefix, year, Date.now() % 1000000);
  }
  return nextEntityCode(key, tenantId);
}

/**
 * @deprecated Use resolveEntityCode when user may provide a code
 */
export async function generateAutoCodeForTenant(
  entityType: string,
  tenantId: string,
  provided?: string | null,
): Promise<string> {
  const key = LEGACY_ENTITY_MAP[entityType];
  if (!key) {
    return generateAutoCode(entityType, [], tenantId);
  }
  return resolveEntityCode(provided, key, tenantId);
}

export function generateRandomCode(prefix: string): string {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 999999) + 1;
  return formatEntityCode(prefix, year, random);
}

export function isCodeExists(code: string, existingCodes: string[]): boolean {
  return existingCodes.includes(code);
}

/**
 * @deprecated Use nextEntityCode from code-sequence.service
 */
export function getNextSequentialCode(
  prefix: string,
  existingCodes: string[],
): string {
  const year = new Date().getFullYear();
  const max = existingCodes.reduce((m, code) => {
    const match = code.match(new RegExp(`^${prefix}-${year}-(\\d+)$`, 'i'));
    return match ? Math.max(m, parseInt(match[1], 10)) : m;
  }, 0);
  return formatEntityCode(prefix, year, max + 1);
}
