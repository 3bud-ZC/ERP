/**
 * Invoice number auto-generation (delegates to unified code sequence).
 */

import {
  CODE_ENTITY_KEYS,
  resolveEntityCode,
} from './code-sequence.service';

export type InvoicePrefix = 'INV' | 'PI' | 'PINV';

/**
 * Resolve the invoice number to use.
 *
 * @param providedNumber  Whatever the client sent (may be undefined / empty).
 * @param prefix          'INV' for sales; 'PI' or 'PINV' for purchase (both → PINV sequence).
 * @param tenantId        Tenant scope (numbers are sequential per tenant).
 * @param year            Optional year (defaults to current).
 */
export async function resolveInvoiceNumber(
  _providedNumber: string | null | undefined,
  prefix: InvoicePrefix,
  tenantId: string,
  year: number = new Date().getFullYear(),
): Promise<string> {
  const entityKey =
    prefix === 'INV'
      ? CODE_ENTITY_KEYS.SALES_INVOICE
      : CODE_ENTITY_KEYS.PURCHASE_INVOICE;

  const { allocateEntityCode } = await import('./code-sequence.service');
  return allocateEntityCode(entityKey, tenantId, undefined, year);
}
