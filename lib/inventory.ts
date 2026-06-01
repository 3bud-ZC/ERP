/**
 * Stock/Inventory business logic and validation utilities.
 * Ensures inventory integrity: no negative stock, pre-transaction validation.
 * All stock changes are recorded as movements (audit trail).
 */
import { prisma } from './db';

export interface StockValidationResult {
  valid: boolean;
  errors: { productId: string; productName: string; requested: number; available: number }[];
}

/**
 * Record a stock movement (audit trail)
 * DEPRECATED: Use createInventoryTransaction from inventory-transactions.ts instead
 */
export async function recordStockMovement(
  productId: string,
  type: string, // IN, OUT, ADJUSTMENT, MANUFACTURING_IN, MANUFACTURING_OUT
  quantity: number,
  tenantId: string,
  reference?: string,
  referenceType?: string,
  notes?: string
): Promise<void> {
  try {
    await prisma.inventoryTransaction.create({
      data: {
        productId,
        type: type.toLowerCase() as 'purchase' | 'sale' | 'production_in' | 'production_out' | 'adjustment',
        quantity,
        referenceId: reference,
        notes,
        date: new Date(),
        tenantId,
      },
    });
  } catch (error) {
    console.error('Error recording stock movement:', error);
    throw error;
  }
}

/**
 * Validates that all requested quantities are available in stock.
 * Must be called before executing stock-affecting operations (sales, etc.)
 */
export async function validateStockAvailability(
  items: { productId: string; quantity: number }[],
  tenantId?: string
): Promise<StockValidationResult> {
  const errors: StockValidationResult['errors'] = [];

  // Aggregate per product to avoid false positives/negatives when the same product
  // appears on multiple lines in the same invoice.
  const requestedByProduct = new Map<string, number>();
  for (const item of items) {
    const key = String(item.productId || '').trim();
    if (!key) continue;
    requestedByProduct.set(key, (requestedByProduct.get(key) || 0) + Number(item.quantity || 0));
  }

  // Load all affected products
  const productIds = Array.from(requestedByProduct.keys());
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      ...(tenantId ? { tenantId } : {}),
    },
    select: { id: true, nameAr: true, nameEn: true, stock: true },
  });

  const productMap = new Map(products.map((p) => [p.id, p]));

  // Validate aggregated quantities
  requestedByProduct.forEach((requested, productId) => {
    const product = productMap.get(productId);
    if (!product) {
      errors.push({
        productId,
        productName: 'Unknown Product',
        requested,
        available: 0,
      });
    } else if (Number(product.stock || 0) < requested) {
      errors.push({
        productId,
        productName: product.nameAr || product.nameEn || 'Unknown',
        requested,
        available: Number(product.stock || 0),
      });
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Safely decrements stock for multiple products within a transaction.
 * Should only be called after validateStockAvailability has passed.
 * Does NOT perform validation - caller must ensure it's safe.
 */
export async function decrementStockInTransaction(
  tx: any, // Prisma transaction client
  items: { productId: string; quantity: number }[],
  tenantId: string,
  referenceId?: string,
  referenceType?: string
): Promise<void> {
  for (const item of items) {
    await tx.product.update({
      where: { id: item.productId },
      data: {
        stock: {
          decrement: item.quantity,
        },
      },
    });

    // Record stock movement
    if (referenceType && referenceId) {
      await tx.inventoryTransaction.create({
        data: {
          productId: item.productId,
          type: referenceType === 'SalesInvoice' ? 'sale' : 'production_out',
          quantity: -item.quantity,
          referenceId: referenceId,
          date: new Date(),
          tenantId,
        },
      });
    }
  }
}

/**
 * Safely increments stock for multiple products within a transaction.
 */
export async function incrementStockInTransaction(
  tx: any, // Prisma transaction client
  items: { productId: string; quantity: number }[],
  tenantId: string,
  referenceId?: string,
  referenceType?: string
): Promise<void> {
  for (const item of items) {
    await tx.product.update({
      where: { id: item.productId },
      data: {
        stock: {
          increment: item.quantity,
        },
      },
    });

    // Record stock movement
    if (referenceType && referenceId) {
      await tx.inventoryTransaction.create({
        data: {
          productId: item.productId,
          type: referenceType === 'PurchaseInvoice' ? 'purchase' : 'production_in',
          quantity: item.quantity,
          referenceId: referenceId,
          date: new Date(),
          tenantId,
        },
      });
    }
  }
}
