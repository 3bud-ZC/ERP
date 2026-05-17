import { prisma } from '@/lib/db';
import { applyStockTransfer } from '@/lib/services/inventory-movement.service';
import { InvoiceExecutionError } from '@/lib/services/invoice-execution.service';
import { getAvailableStock } from '@/lib/services/warehouse-stock.service';

export async function executeCompleteStockTransfer(params: {
  tenantId: string;
  userId: string;
  transferId: string;
}) {
  const transfer = await prisma.stockTransfer.findFirst({
    where: { id: params.transferId, tenantId: params.tenantId },
  });
  if (!transfer) throw new InvoiceExecutionError('VALIDATION_FAILED', 'Transfer not found');
  if (transfer.status === 'completed') {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'Transfer already completed');
  }

  const avail = await getAvailableStock(
    params.tenantId,
    transfer.productId,
    transfer.fromWarehouseId,
  );
  if (avail < transfer.quantity) {
    throw new InvoiceExecutionError(
      'INVENTORY_FAILED',
      `Insufficient stock in source warehouse. Available: ${avail}, required: ${transfer.quantity}`,
    );
  }

  return prisma.$transaction(
    async tx => {
      await applyStockTransfer(tx, params.tenantId, {
        productId: transfer.productId,
        quantity: transfer.quantity,
        fromWarehouseId: transfer.fromWarehouseId,
        toWarehouseId: transfer.toWarehouseId,
        transferId: transfer.id,
      });

      return tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: 'completed' },
        include: { product: true, fromWarehouse: true, toWarehouse: true },
      });
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 30000 },
  );
}
