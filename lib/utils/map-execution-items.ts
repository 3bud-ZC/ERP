import type { ExecutionInvoiceItem } from '@/lib/services/invoice-execution.service';

/** Map API invoice line payloads to canonical execution items. */
export function mapExecutionItems(rawItems: unknown[]): ExecutionInvoiceItem[] {
  if (!Array.isArray(rawItems)) return [];

  return rawItems
    .filter(
      (it: unknown): it is Record<string, unknown> =>
        !!it &&
        typeof it === 'object' &&
        !!(it as Record<string, unknown>).productId &&
        Number((it as Record<string, unknown>).quantity) > 0,
    )
    .map(it => ({
      productId: String(it.productId),
      quantity: Number(it.quantity) || 0,
      price: Number(it.price ?? it.unitCost) || 0,
      unitCost: it.unitCost != null ? Number(it.unitCost) : undefined,
      discountPercent: it.discountPercent != null ? Number(it.discountPercent) : undefined,
      taxRate: it.taxRate != null ? Number(it.taxRate) : undefined,
      description: it.description != null ? String(it.description) : undefined,
    }));
}
