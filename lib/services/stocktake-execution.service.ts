import { prisma } from '@/lib/db';
import { getPostingProfile } from '@/lib/services/accounting-posting-profile.service';
import {
  postJournalLinesInTransaction,
  type JournalLineDraft,
} from '@/lib/services/invoice-accounting.service';
import { buildStockAdjustmentJournalLines } from '@/lib/services/inventory-accounting.service';
import {
  applyStockAdjustmentDecrease,
  applyStockAdjustmentIncrease,
} from '@/lib/services/inventory-movement.service';
import { assertCanPostReference } from '@/lib/services/posting-guard.service';
import { InvoiceExecutionError } from '@/lib/services/execution-errors';

export async function executeCompleteStocktake(params: {
  tenantId: string;
  userId: string;
  stocktakeId: string;
}) {
  const stocktake = await prisma.stocktake.findFirst({
    where: { id: params.stocktakeId, tenantId: params.tenantId },
    include: { items: { include: { product: true } } },
  });
  if (!stocktake) throw new InvoiceExecutionError('VALIDATION_FAILED', 'Stocktake not found');
  if (stocktake.status === 'completed') {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'Stocktake already completed');
  }

  const profile = await getPostingProfile(params.tenantId);
  const warehouseId = stocktake.warehouseId;

  return prisma.$transaction(
    async tx => {
      await assertCanPostReference(tx, params.tenantId, 'Stocktake', stocktake.id);

      const journalLines: JournalLineDraft[] = [];

      for (const item of stocktake.items) {
        if (item.variance === 0 || item.adjusted) continue;

        const value =
          item.variance > 0
            ? await applyStockAdjustmentIncrease(
                tx,
                params.tenantId,
                { productId: item.productId, quantity: item.variance },
                stocktake.id,
                warehouseId,
              )
            : await applyStockAdjustmentDecrease(
                tx,
                params.tenantId,
                { productId: item.productId, quantity: Math.abs(item.variance) },
                stocktake.id,
                warehouseId,
              );

        const adjType = item.variance > 0 ? 'increase' : 'decrease';
        journalLines.push(
          ...buildStockAdjustmentJournalLines(adjType, value, params.tenantId, profile),
        );

        await tx.stocktakeItem.update({
          where: { id: item.id },
          data: { adjusted: true },
        });
      }

      let journalEntry = null;
      if (journalLines.length > 0) {
        journalEntry = await postJournalLinesInTransaction(tx, {
          tenantId: params.tenantId,
          userId: params.userId,
          entryDate: stocktake.date,
          description: `Stocktake ${stocktake.stocktakeNumber}`,
          referenceType: 'Stocktake',
          referenceId: stocktake.id,
          lines: journalLines,
          correlationId: `${stocktake.id}:post`,
        });
      }

      const updated = await tx.stocktake.update({
        where: { id: stocktake.id },
        data: { status: 'completed' },
        include: { warehouse: true, items: { include: { product: true } } },
      });

      return { stocktake: updated, journalEntry };
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 30000 },
  );
}
