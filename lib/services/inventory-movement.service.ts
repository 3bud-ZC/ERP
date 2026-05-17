/**
 * Canonical inventory movements — all stock + costing go through here.
 */

import { Prisma } from '@prisma/client';
import {
  recordStockInflowWithTx,
  recordStockOutflowWithTx,
  getUnitCostInTx,
} from '@/lib/inventory-costing-bridge';
import { InvoiceExecutionError } from '@/lib/services/invoice-execution.service';
import {
  getAvailableStockInTx,
  upsertWarehouseStockDelta,
} from '@/lib/services/warehouse-stock.service';

export interface StockLine {
  productId: string;
  quantity: number;
  unitCost?: number;
}

async function resolveWarehouseId(
  tx: Prisma.TransactionClient,
  tenantId: string,
  productId: string,
  warehouseId?: string | null,
): Promise<string | null> {
  if (warehouseId) return warehouseId;
  const product = await tx.product.findFirst({
    where: { id: productId, tenantId },
    select: { warehouseId: true },
  });
  return product?.warehouseId ?? null;
}

async function changeProductStock(
  tx: Prisma.TransactionClient,
  tenantId: string,
  productId: string,
  delta: number,
  warehouseId?: string | null,
): Promise<void> {
  const wh = await resolveWarehouseId(tx, tenantId, productId, warehouseId);
  if (wh) {
    if (delta < 0) {
      const avail = await getAvailableStockInTx(tx, tenantId, productId, wh);
      if (avail < Math.abs(delta)) {
        await assertSufficientStock(tx, tenantId, productId, Math.abs(delta), wh);
      }
    }
    await upsertWarehouseStockDelta(tx, tenantId, productId, wh, delta);
    return;
  }

  if (delta < 0) {
    const result = await tx.product.updateMany({
      where: {
        id: productId,
        tenantId,
        stock: { gte: Math.abs(delta) },
      },
      data: { stock: { decrement: Math.abs(delta) }, version: { increment: 1 } },
    });
    if (result.count === 0) {
      await assertSufficientStock(tx, tenantId, productId, Math.abs(delta));
      throw new InvoiceExecutionError('INVENTORY_FAILED', 'Stock update failed');
    }
  } else {
    const result = await tx.product.updateMany({
      where: { id: productId, tenantId },
      data: { stock: { increment: delta }, version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new InvoiceExecutionError('INVENTORY_FAILED', `Product ${productId} not found`);
    }
  }
}

export async function assertSufficientStock(
  tx: Prisma.TransactionClient,
  tenantId: string,
  productId: string,
  quantity: number,
  warehouseId?: string | null,
): Promise<void> {
  const product = await tx.product.findFirst({
    where: { id: productId, tenantId },
    select: { nameAr: true },
  });
  if (!product) {
    throw new InvoiceExecutionError('INVENTORY_FAILED', `Product ${productId} not found`);
  }
  const available = await getAvailableStockInTx(tx, tenantId, productId, warehouseId);
  if (available < quantity) {
    throw new InvoiceExecutionError(
      'INVENTORY_FAILED',
      `Insufficient stock for "${product.nameAr}". Available: ${available}, required: ${quantity}`,
    );
  }
}

/** Atomic stock decrement + costing outflow + audit row. */
export async function applySalesOutflow(
  tx: Prisma.TransactionClient,
  tenantId: string,
  line: StockLine,
  referenceType: string,
  referenceId: string,
): Promise<number> {
  await changeProductStock(tx, tenantId, line.productId, -line.quantity);

  const cogs = await recordStockOutflowWithTx(
    tx,
    tenantId,
    line.productId,
    line.quantity,
    referenceType,
    referenceId,
  );

  await tx.inventoryTransaction.create({
    data: {
      productId: line.productId,
      type: 'sale',
      quantity: -line.quantity,
      referenceId,
      referenceType,
      unitCost: line.quantity > 0 ? cogs / line.quantity : 0,
      totalCost: cogs,
      tenantId,
      date: new Date(),
    },
  });

  return cogs;
}

/** Atomic stock increment + costing inflow + audit row. */
export async function applyPurchaseInflow(
  tx: Prisma.TransactionClient,
  tenantId: string,
  line: StockLine,
  referenceType: string,
  referenceId: string,
): Promise<void> {
  await changeProductStock(tx, tenantId, line.productId, line.quantity);

  const unitCost = line.unitCost ?? 0;
  await recordStockInflowWithTx(
    tx,
    tenantId,
    line.productId,
    line.quantity,
    unitCost,
    referenceType,
    referenceId,
  );

  const warehouseId = await resolveWarehouseId(tx, tenantId, line.productId);
  await tx.inventoryTransaction.create({
    data: {
      productId: line.productId,
      type: 'purchase',
      quantity: line.quantity,
      referenceId,
      referenceType,
      unitCost,
      totalCost: line.quantity * unitCost,
      tenantId,
      date: new Date(),
    },
  });
}

/** Restore stock on sales return (inflow at returned unit cost). */
export async function applySalesReturnInflow(
  tx: Prisma.TransactionClient,
  tenantId: string,
  line: StockLine,
  returnId: string,
): Promise<number> {
  await changeProductStock(tx, tenantId, line.productId, line.quantity);

  const unitCost = line.unitCost ?? 0;
  if (unitCost > 0) {
    await recordStockInflowWithTx(
      tx,
      tenantId,
      line.productId,
      line.quantity,
      unitCost,
      'SalesReturn',
      returnId,
    );
  }

  const warehouseId = await resolveWarehouseId(tx, tenantId, line.productId);
  await tx.inventoryTransaction.create({
    data: {
      productId: line.productId,
      type: 'return',
      quantity: line.quantity,
      referenceId: returnId,
      referenceType: 'SalesReturn',
      unitCost: unitCost,
      totalCost: unitCost * line.quantity,
      tenantId,
      date: new Date(),
    },
  });

  return unitCost * line.quantity;
}

/** Reverse prior sale lines for an invoice (used on edit/cancel). */
export async function reverseInvoiceStockMovements(
  tx: Prisma.TransactionClient,
  tenantId: string,
  referenceId: string,
  referenceTypes: string[],
): Promise<void> {
  const movements = await tx.inventoryTransaction.findMany({
    where: {
      tenantId,
      referenceId,
      referenceType: { in: referenceTypes },
    },
  });

  const toReverse = movements.filter(
    m => m.referenceType && !m.referenceType.includes(':reversal'),
  );
  const movementIds = toReverse.map(m => m.id);

  for (const m of toReverse) {
    const qty = Math.abs(m.quantity);
    if (qty <= 0) continue;

    if (m.quantity < 0) {
      await applyPurchaseInflow(tx, tenantId, {
        productId: m.productId,
        quantity: qty,
        unitCost: m.unitCost ?? 0,
      }, `${m.referenceType}:reversal`, referenceId);
    } else {
      await applySalesOutflow(tx, tenantId, {
        productId: m.productId,
        quantity: qty,
      }, `${m.referenceType}:reversal`, referenceId);
    }
  }

  if (movementIds.length > 0) {
    await tx.inventoryTransaction.deleteMany({ where: { id: { in: movementIds } } });
  }
}

/** Raw material consumption for production (FIFO/WAC outflow). */
export async function applyProductionMaterialOutflow(
  tx: Prisma.TransactionClient,
  tenantId: string,
  line: StockLine,
  productionOrderId: string,
): Promise<number> {
  await changeProductStock(tx, tenantId, line.productId, -line.quantity);

  const cogs = await recordStockOutflowWithTx(
    tx,
    tenantId,
    line.productId,
    line.quantity,
    'ProductionOrder',
    productionOrderId,
  );

  await tx.inventoryTransaction.create({
    data: {
      productId: line.productId,
      type: 'production_out',
      quantity: -line.quantity,
      referenceId: productionOrderId,
      referenceType: 'ProductionOrder',
      unitCost: line.quantity > 0 ? cogs / line.quantity : 0,
      totalCost: cogs,
      tenantId,
      date: new Date(),
    },
  });

  return cogs;
}

/** Finished goods receipt from production (FIFO/WAC inflow at unit cost). */
export async function applyStockAdjustmentIncrease(
  tx: Prisma.TransactionClient,
  tenantId: string,
  line: StockLine,
  adjustmentId: string,
  warehouseId?: string | null,
): Promise<number> {
  const product = await tx.product.findFirst({
    where: { id: line.productId, tenantId },
    select: { cost: true },
  });
  const unitCost =
    line.unitCost ?? ((await getUnitCostInTx(tx, line.productId)) || product?.cost || 0);

  await changeProductStock(tx, tenantId, line.productId, line.quantity, warehouseId);

  await recordStockInflowWithTx(
    tx,
    tenantId,
    line.productId,
    line.quantity,
    unitCost,
    'StockAdjustment',
    adjustmentId,
  );

  const wh = warehouseId ?? (await resolveWarehouseId(tx, tenantId, line.productId));
  await tx.inventoryTransaction.create({
    data: {
      productId: line.productId,
      type: 'adjustment',
      quantity: line.quantity,
      referenceId: adjustmentId,
      referenceType: 'StockAdjustment',
      unitCost,
      totalCost: line.quantity * unitCost,
      warehouseId: wh ?? undefined,
      tenantId,
      date: new Date(),
    },
  });

  return line.quantity * unitCost;
}

export async function applyStockAdjustmentDecrease(
  tx: Prisma.TransactionClient,
  tenantId: string,
  line: StockLine,
  adjustmentId: string,
  warehouseId?: string | null,
): Promise<number> {
  await changeProductStock(tx, tenantId, line.productId, -line.quantity, warehouseId);

  const cogs = await recordStockOutflowWithTx(
    tx,
    tenantId,
    line.productId,
    line.quantity,
    'StockAdjustment',
    adjustmentId,
  );

  const wh = warehouseId ?? (await resolveWarehouseId(tx, tenantId, line.productId));
  await tx.inventoryTransaction.create({
    data: {
      productId: line.productId,
      type: 'adjustment',
      quantity: -line.quantity,
      referenceId: adjustmentId,
      referenceType: 'StockAdjustment',
      unitCost: line.quantity > 0 ? cogs / line.quantity : 0,
      totalCost: cogs,
      warehouseId: wh ?? undefined,
      tenantId,
      date: new Date(),
    },
  });

  return cogs;
}

export async function applyProductionFinishedInflow(
  tx: Prisma.TransactionClient,
  tenantId: string,
  line: StockLine,
  productionOrderId: string,
): Promise<void> {
  const unitCost = line.unitCost ?? 0;
  await changeProductStock(tx, tenantId, line.productId, line.quantity);

  await recordStockInflowWithTx(
    tx,
    tenantId,
    line.productId,
    line.quantity,
    unitCost,
    'ProductionOrder',
    productionOrderId,
  );

  const warehouseId = await resolveWarehouseId(tx, tenantId, line.productId);
  await tx.inventoryTransaction.create({
    data: {
      productId: line.productId,
      type: 'production_in',
      quantity: line.quantity,
      referenceId: productionOrderId,
      referenceType: 'ProductionOrder',
      unitCost,
      totalCost: line.quantity * unitCost,
      warehouseId: warehouseId ?? undefined,
      tenantId,
      date: new Date(),
    },
  });
}

/** Inter-warehouse transfer — no FIFO layer change; warehouse quantities only. */
export async function applyStockTransfer(
  tx: Prisma.TransactionClient,
  tenantId: string,
  params: {
    productId: string;
    quantity: number;
    fromWarehouseId: string;
    toWarehouseId: string;
    transferId: string;
  },
): Promise<void> {
  const { productId, quantity, fromWarehouseId, toWarehouseId, transferId } = params;
  const avail = await getAvailableStockInTx(tx, tenantId, productId, fromWarehouseId);
  if (avail < quantity) {
    await assertSufficientStock(tx, tenantId, productId, quantity, fromWarehouseId);
  }

  const unitCost = (await getUnitCostInTx(tx, productId)) || 0;
  await upsertWarehouseStockDelta(tx, tenantId, productId, fromWarehouseId, -quantity);
  await upsertWarehouseStockDelta(tx, tenantId, productId, toWarehouseId, quantity);

  const totalCost = unitCost * quantity;
  await tx.inventoryTransaction.create({
    data: {
      productId,
      type: 'transfer_out',
      quantity: -quantity,
      referenceId: transferId,
      referenceType: 'StockTransfer',
      warehouseId: fromWarehouseId,
      unitCost,
      totalCost,
      tenantId,
      date: new Date(),
    },
  });
  await tx.inventoryTransaction.create({
    data: {
      productId,
      type: 'transfer_in',
      quantity,
      referenceId: transferId,
      referenceType: 'StockTransfer',
      warehouseId: toWarehouseId,
      unitCost,
      totalCost,
      tenantId,
      date: new Date(),
    },
  });
}

export async function applyProductionWasteOutflow(
  tx: Prisma.TransactionClient,
  tenantId: string,
  line: StockLine,
  wasteId: string,
  warehouseId?: string | null,
): Promise<number> {
  await changeProductStock(tx, tenantId, line.productId, -line.quantity, warehouseId);
  const cogs = await recordStockOutflowWithTx(
    tx,
    tenantId,
    line.productId,
    line.quantity,
    'ProductionWaste',
    wasteId,
  );
  const wh = warehouseId ?? (await resolveWarehouseId(tx, tenantId, line.productId));
  await tx.inventoryTransaction.create({
    data: {
      productId: line.productId,
      type: 'waste',
      quantity: -line.quantity,
      referenceId: wasteId,
      referenceType: 'ProductionWaste',
      unitCost: line.quantity > 0 ? cogs / line.quantity : 0,
      totalCost: cogs,
      warehouseId: wh ?? undefined,
      tenantId,
      date: new Date(),
    },
  });
  return cogs;
}

export async function applyProductionWasteReversal(
  tx: Prisma.TransactionClient,
  tenantId: string,
  line: StockLine,
  wasteId: string,
  warehouseId?: string | null,
): Promise<void> {
  const unitCost = line.unitCost ?? (await getUnitCostInTx(tx, line.productId)) ?? 0;
  await changeProductStock(tx, tenantId, line.productId, line.quantity, warehouseId);
  if (unitCost > 0) {
    await recordStockInflowWithTx(
      tx,
      tenantId,
      line.productId,
      line.quantity,
      unitCost,
      'ProductionWaste',
      `${wasteId}:reversal`,
    );
  }
  const wh = warehouseId ?? (await resolveWarehouseId(tx, tenantId, line.productId));
  await tx.inventoryTransaction.create({
    data: {
      productId: line.productId,
      type: 'waste_reversal',
      quantity: line.quantity,
      referenceId: wasteId,
      referenceType: 'ProductionWaste',
      unitCost,
      totalCost: unitCost * line.quantity,
      warehouseId: wh ?? undefined,
      tenantId,
      date: new Date(),
    },
  });
}
