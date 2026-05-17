import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export async function upsertWarehouseStockDelta(
  tx: Prisma.TransactionClient,
  tenantId: string,
  productId: string,
  warehouseId: string,
  delta: number,
): Promise<void> {
  const existing = await tx.warehouseStock.findUnique({
    where: {
      tenantId_productId_warehouseId: { tenantId, productId, warehouseId },
    },
  });

  if (existing) {
    await tx.warehouseStock.update({
      where: { id: existing.id },
      data: { quantity: { increment: delta } },
    });
  } else {
    await tx.warehouseStock.create({
      data: {
        tenantId,
        productId,
        warehouseId,
        quantity: Math.max(0, delta),
        reservedQty: 0,
      },
    });
  }

  await syncProductStockTotal(tx, tenantId, productId);
}

export async function syncProductStockTotal(
  tx: Prisma.TransactionClient,
  tenantId: string,
  productId: string,
): Promise<void> {
  const agg = await tx.warehouseStock.aggregate({
    where: { tenantId, productId },
    _sum: { quantity: true },
  });
  const total = agg._sum.quantity ?? 0;
  await tx.product.updateMany({
    where: { id: productId, tenantId },
    data: { stock: total },
  });
}

export async function backfillWarehouseStockFromProducts(tenantId: string): Promise<number> {
  const products = await prisma.product.findMany({
    where: { tenantId, warehouseId: { not: null } },
    select: { id: true, warehouseId: true, stock: true },
  });

  let count = 0;
  await prisma.$transaction(async tx => {
    for (const p of products) {
      if (!p.warehouseId) continue;
      await tx.warehouseStock.upsert({
        where: {
          tenantId_productId_warehouseId: {
            tenantId,
            productId: p.id,
            warehouseId: p.warehouseId,
          },
        },
        create: {
          tenantId,
          productId: p.id,
          warehouseId: p.warehouseId,
          quantity: p.stock,
          reservedQty: 0,
        },
        update: { quantity: p.stock },
      });
      count++;
    }
  });
  return count;
}

export async function getAvailableStockInTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  productId: string,
  warehouseId?: string | null,
): Promise<number> {
  if (warehouseId) {
    const row = await tx.warehouseStock.findUnique({
      where: {
        tenantId_productId_warehouseId: { tenantId, productId, warehouseId },
      },
    });
    if (!row) return 0;
    return Math.max(0, row.quantity - row.reservedQty);
  }
  const product = await tx.product.findFirst({
    where: { id: productId, tenantId },
    select: { stock: true },
  });
  const reserved = await tx.stockReservation.aggregate({
    where: { productId, tenantId, status: 'reserved' },
    _sum: { reservedQuantity: true },
  });
  const res = reserved._sum.reservedQuantity ?? 0;
  return Math.max(0, (product?.stock ?? 0) - res);
}

export async function getAvailableStock(
  tenantId: string,
  productId: string,
  warehouseId?: string | null,
): Promise<number> {
  return prisma.$transaction(tx =>
    getAvailableStockInTx(tx, tenantId, productId, warehouseId),
  );
}
