import { prisma } from '@/lib/db';
import { getPostingProfile } from '@/lib/services/accounting-posting-profile.service';
import { postJournalLinesInTransaction } from '@/lib/services/invoice-accounting.service';
import { buildStockAdjustmentJournalLines } from '@/lib/services/inventory-accounting.service';
import {
  applyStockAdjustmentDecrease,
  applyStockAdjustmentIncrease,
} from '@/lib/services/inventory-movement.service';
import { assertCanPostReference } from '@/lib/services/posting-guard.service';
import { InvoiceExecutionError } from '@/lib/services/execution-errors';

export async function executeApproveStockAdjustment(params: {
  tenantId: string;
  userId: string;
  adjustmentId: string;
}) {
  const adj = await prisma.stockAdjustment.findFirst({
    where: { id: params.adjustmentId, tenantId: params.tenantId },
    include: { product: true },
  });
  if (!adj) throw new InvoiceExecutionError('VALIDATION_FAILED', 'Adjustment not found');
  if (adj.status === 'approved') {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'Already approved');
  }

  if (!adj.applyToStock) {
    const updated = await prisma.stockAdjustment.update({
      where: { id: adj.id },
      data: { status: 'approved' },
      include: { product: true },
    });
    return { adjustment: updated, journalEntry: null };
  }

  const profile = await getPostingProfile(params.tenantId);
  const type = adj.type as 'increase' | 'decrease';
  const warehouseId = adj.product.warehouseId;

  return prisma.$transaction(
    async tx => {
      await assertCanPostReference(tx, params.tenantId, 'StockAdjustment', adj.id);

      const value =
        type === 'increase'
          ? await applyStockAdjustmentIncrease(
              tx,
              params.tenantId,
              { productId: adj.productId, quantity: adj.quantity },
              adj.id,
              warehouseId,
            )
          : await applyStockAdjustmentDecrease(
              tx,
              params.tenantId,
              { productId: adj.productId, quantity: adj.quantity },
              adj.id,
              warehouseId,
            );

      const lines = buildStockAdjustmentJournalLines(type, value, params.tenantId, profile);
      const journalEntry = await postJournalLinesInTransaction(tx, {
        tenantId: params.tenantId,
        userId: params.userId,
        entryDate: adj.date,
        description: `Stock adjustment ${adj.adjustmentNumber}`,
        referenceType: 'StockAdjustment',
        referenceId: adj.id,
        lines,
        correlationId: `${adj.id}:post`,
      });

      const updated = await tx.stockAdjustment.update({
        where: { id: adj.id },
        data: { status: 'approved', journalEntryId: journalEntry.id },
        include: { product: true },
      });

      return { adjustment: updated, journalEntry };
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 30000 },
  );
}

export async function executeCreateAndApproveStockAdjustment(params: {
  tenantId: string;
  userId: string;
  productId: string;
  type: 'increase' | 'decrease';
  quantity: number;
  reason: string;
  notes?: string;
  date?: Date;
  adjustmentNumber: string;
}) {
  const adjustment = await prisma.stockAdjustment.create({
    data: {
      adjustmentNumber: params.adjustmentNumber,
      productId: params.productId,
      type: params.type,
      quantity: params.quantity,
      reason: params.reason,
      notes: params.notes,
      status: 'pending',
      date: params.date ?? new Date(),
      tenantId: params.tenantId,
    },
  });

  const result = await executeApproveStockAdjustment({
    tenantId: params.tenantId,
    userId: params.userId,
    adjustmentId: adjustment.id,
  });

  return result.adjustment;
}
