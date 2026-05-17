import { prisma } from '@/lib/db';
import {
  applyProductionWasteOutflow,
  applyProductionWasteReversal,
} from '@/lib/services/inventory-movement.service';
import { InvoiceExecutionError } from '@/lib/services/invoice-execution.service';
import { getAvailableStock } from '@/lib/services/warehouse-stock.service';

export async function executeCreateProductionWaste(params: {
  tenantId: string;
  productId: string;
  quantity: number;
  date?: Date;
  productionOrderId?: string | null;
  notes?: string | null;
}) {
  const product = await prisma.product.findFirst({
    where: { id: params.productId, tenantId: params.tenantId },
    select: { id: true, warehouseId: true, nameAr: true },
  });
  if (!product) throw new InvoiceExecutionError('VALIDATION_FAILED', 'Product not found');

  const avail = await getAvailableStock(
    params.tenantId,
    params.productId,
    product.warehouseId,
  );
  if (avail < params.quantity) {
    throw new InvoiceExecutionError(
      'INVENTORY_FAILED',
      `Insufficient stock. Available: ${avail}, required: ${params.quantity}`,
    );
  }

  return prisma.$transaction(
    async tx => {
      const created = await tx.productionWaste.create({
        data: {
          productId: params.productId,
          quantity: params.quantity,
          date: params.date ?? new Date(),
          productionOrderId: params.productionOrderId ?? null,
          notes: params.notes ?? null,
          tenantId: params.tenantId,
        },
        include: { product: true, productionOrder: true },
      });

      await applyProductionWasteOutflow(
        tx,
        params.tenantId,
        { productId: params.productId, quantity: params.quantity },
        created.id,
        product.warehouseId,
      );

      return created;
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 30000 },
  );
}

export async function executeDeleteProductionWaste(params: {
  tenantId: string;
  wasteId: string;
}) {
  const waste = await prisma.productionWaste.findFirst({
    where: { id: params.wasteId, tenantId: params.tenantId },
    include: { product: { select: { warehouseId: true } } },
  });
  if (!waste) throw new InvoiceExecutionError('VALIDATION_FAILED', 'Waste record not found');

  return prisma.$transaction(
    async tx => {
      await applyProductionWasteReversal(
        tx,
        params.tenantId,
        { productId: waste.productId, quantity: Number(waste.quantity) },
        waste.id,
        waste.product.warehouseId,
      );
      await tx.productionWaste.delete({ where: { id: waste.id } });
      return { id: waste.id };
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 30000 },
  );
}
