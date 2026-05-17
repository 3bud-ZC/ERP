/**
 * Transaction-safe bridge between stock movements and the inventory costing engine.
 * All operational flows should call these helpers inside the same Prisma transaction
 * as quantity updates so costing rolls back with inventory on failure.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { createInventoryCostingEngine } from '@/lib/inventory-costing';

export { InsufficientCostLayersError } from '@/lib/inventory-costing';

/** Map inventory transaction types to costing reference labels. */
export function inventoryRefType(
  transactionType: string,
): string {
  switch (transactionType) {
    case 'purchase':
      return 'PurchaseInvoice';
    case 'sale':
      return 'SalesInvoice';
    case 'production_in':
    case 'production_out':
      return 'ProductionOrder';
    case 'adjustment':
      return 'StockAdjustment';
    case 'return':
      return 'SalesReturn';
    case 'purchase_return':
      return 'PurchaseReturn';
    default:
      return transactionType;
  }
}

/** Sync denormalized Product.cost from valuation (display / legacy reads only). */
export async function syncProductCostFromValuation(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<void> {
  const valuation = await tx.inventoryValuation.findUnique({
    where: { productId },
  });
  if (valuation && valuation.averageCost >= 0) {
    await tx.product.update({
      where: { id: productId },
      data: { cost: valuation.averageCost },
    });
  }
}

export async function recordStockInflowWithTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  productId: string,
  quantity: number,
  unitCost: number,
  referenceType: string,
  referenceId: string,
): Promise<void> {
  if (quantity <= 0) return;
  const engine = createInventoryCostingEngine(tenantId, tx);
  await engine.recordStockInflow(
    productId,
    quantity,
    unitCost,
    referenceType,
    referenceId,
  );
  await syncProductCostFromValuation(tx, productId);
}

export async function recordStockOutflowWithTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  productId: string,
  quantity: number,
  referenceType: string,
  referenceId: string,
): Promise<number> {
  if (quantity <= 0) return 0;
  const engine = createInventoryCostingEngine(tenantId, tx);
  const cogs = await engine.recordStockOutflow(
    productId,
    quantity,
    referenceType,
    referenceId,
  );
  await syncProductCostFromValuation(tx, productId);
  return cogs;
}

/** Read weighted-average cost inside a transaction (valuation first). */
export async function getUnitCostInTx(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<number> {
  const valuation = await tx.inventoryValuation.findUnique({
    where: { productId },
  });
  if (valuation && valuation.totalQuantity > 0) {
    return valuation.averageCost;
  }
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { cost: true },
  });
  return product?.cost ?? 0;
}

/** Non-transactional read for UI / planning. */
export async function getUnitCostForProduct(
  tenantId: string,
  productId: string,
): Promise<number> {
  const valuation = await prisma.inventoryValuation.findUnique({
    where: { productId },
  });
  if (valuation && valuation.totalQuantity > 0) {
    return valuation.averageCost;
  }
  const product = await prisma.product.findUnique({
    where: { id: productId, tenantId },
    select: { cost: true },
  });
  return product?.cost ?? 0;
}
