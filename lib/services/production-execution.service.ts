/**
 * Phase 6A — canonical manufacturing execution (atomic stock + GL).
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { CODE_ENTITY_KEYS, allocateEntityCode } from '@/lib/code-sequence.service';
import { InvoiceExecutionError } from '@/lib/services/execution-errors';
import { getPostingProfile } from '@/lib/services/accounting-posting-profile.service';
import { postJournalLinesInTransaction } from '@/lib/services/invoice-accounting.service';
import {
  buildRawMaterialConsumptionLines,
  buildManufacturingLaborLines,
  buildManufacturingOverheadLines,
  buildProductionCompletionLines,
  PRODUCTION_REF,
} from '@/lib/services/production-accounting.service';
import {
  applyProductionMaterialOutflow,
  applyProductionFinishedInflow,
  reverseInvoiceStockMovements,
} from '@/lib/services/inventory-movement.service';
import { assertCanPostReference } from '@/lib/services/posting-guard.service';
import { reverseJournalEntriesByReferenceId } from '@/lib/services/journal-reversal.service';
import { toArabicError } from '@/lib/utils/arabic-errors';
import {
  recordCashboxTransactionInTx,
  reverseCashboxTransactionsInTx,
} from '@/lib/services/cashbox.service';

export type ProductionExecutionError = InvoiceExecutionError;

export interface ProductionMaterialLine {
  productId: string;
  quantity: number;
}

export interface CreateProductionOrderInput {
  orderNumber: string;
  productId: string;
  quantity: number;
  date: Date;
  status?: string;
  notes?: string;
  productionLineId?: string;
  laborCost?: number;
  overheadCost?: number;
  cashboxId?: string;
  laborPaymentCategory?: string;
  overheadPaymentCategory?: string;
}

const PRODUCTION_COST_REF = 'ProductionOrderCost';
const AUTO_PRODUCTION_WASTE_ADJUSTMENT_REF = 'ProductionOrderWasteAuto';

function buildProductionCostDescription(params: {
  category: string;
  orderNumber: string;
  reason: string;
}) {
  return `category:${params.category}::party:أمر إنتاج ${params.orderNumber}::reason:${params.reason}`;
}

async function createAutoWasteStockAdjustmentInTx(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    productId: string;
    productionOrderId: string;
    orderNumber: string;
    quantity: number;
    date: Date;
    plannedQuantity: number;
    actualOutputQuantity: number;
  },
) {
  const adjustmentNumber = await allocateEntityCode(
    CODE_ENTITY_KEYS.STOCK_ADJUSTMENT,
    params.tenantId,
    tx,
  );

  return tx.stockAdjustment.create({
    data: {
      adjustmentNumber,
      productId: params.productId,
      type: 'decrease',
      quantity: params.quantity,
      reason: 'lost',
      applyToStock: false,
      sourceType: AUTO_PRODUCTION_WASTE_ADJUSTMENT_REF,
      sourceId: params.productionOrderId,
      status: 'approved',
      date: params.date,
      notes: `أمر الإنتاج ${params.orderNumber} - المخطط ${params.plannedQuantity} - المنتج فعليًا ${params.actualOutputQuantity}`,
      tenantId: params.tenantId,
    },
  });
}

async function consumeRawMaterialsInTx(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    userId: string;
    productionOrderId: string;
    orderNumber: string;
    entryDate: Date;
    items: ProductionMaterialLine[];
    laborCost: number;
    overheadCost: number;
    cashboxId?: string;
    laborPaymentCategory: string;
    overheadPaymentCategory: string;
    profile: Awaited<ReturnType<typeof getPostingProfile>>;
  },
): Promise<{ rawMaterialCost: number; totalCost: number }> {
  const {
    tenantId,
    userId,
    productionOrderId,
    orderNumber,
    entryDate,
    items,
    laborCost,
    overheadCost,
    cashboxId,
    laborPaymentCategory,
    overheadPaymentCategory,
    profile,
  } =
    params;

  let rawMaterialCost = 0;
  for (const line of items) {
    rawMaterialCost += await applyProductionMaterialOutflow(
      tx,
      tenantId,
      { productId: line.productId, quantity: line.quantity },
      productionOrderId,
    );
  }

  const totalCost = rawMaterialCost + laborCost + overheadCost;

  await assertCanPostReference(tx, tenantId, PRODUCTION_REF.RM, productionOrderId);
  const rmLines = buildRawMaterialConsumptionLines(rawMaterialCost, tenantId, profile);
  if (rmLines.length > 0) {
    await postJournalLinesInTransaction(tx, {
      tenantId,
      userId,
      entryDate,
      description: `RM consumption — ${orderNumber}`,
      referenceType: PRODUCTION_REF.RM,
      referenceId: productionOrderId,
      lines: rmLines,
      correlationId: `${productionOrderId}:rm`,
    });
  }

  if (laborCost > 0.001) {
    await assertCanPostReference(tx, tenantId, PRODUCTION_REF.LABOR, productionOrderId);
    await postJournalLinesInTransaction(tx, {
      tenantId,
      userId,
      entryDate,
      description: `Labor — ${orderNumber}`,
      referenceType: PRODUCTION_REF.LABOR,
      referenceId: productionOrderId,
      lines: buildManufacturingLaborLines(laborCost, tenantId, profile),
      correlationId: `${productionOrderId}:labor`,
    });
  }

  if (overheadCost > 0.001) {
    await assertCanPostReference(tx, tenantId, PRODUCTION_REF.OVERHEAD, productionOrderId);
    await postJournalLinesInTransaction(tx, {
      tenantId,
      userId,
      entryDate,
      description: `Overhead — ${orderNumber}`,
      referenceType: PRODUCTION_REF.OVERHEAD,
      referenceId: productionOrderId,
      lines: buildManufacturingOverheadLines(overheadCost, tenantId, profile),
      correlationId: `${productionOrderId}:overhead`,
    });
  }

  if (cashboxId && laborCost > 0.001) {
    await recordCashboxTransactionInTx(tx, {
      tenantId,
      cashboxId,
      type: 'manual_out',
      direction: 'out',
      amount: laborCost,
      date: entryDate,
      referenceType: PRODUCTION_COST_REF,
      referenceId: productionOrderId,
      description: buildProductionCostDescription({
        category: laborPaymentCategory,
        orderNumber,
        reason: `عمالة مباشرة لأمر الإنتاج ${orderNumber}`,
      }),
      createdBy: userId,
    });
  }

  if (cashboxId && overheadCost > 0.001) {
    await recordCashboxTransactionInTx(tx, {
      tenantId,
      cashboxId,
      type: 'manual_out',
      direction: 'out',
      amount: overheadCost,
      date: entryDate,
      referenceType: PRODUCTION_COST_REF,
      referenceId: productionOrderId,
      description: buildProductionCostDescription({
        category: overheadPaymentCategory,
        orderNumber,
        reason: `تشغيل لأمر الإنتاج ${orderNumber}`,
      }),
      createdBy: userId,
    });
  }

  return { rawMaterialCost, totalCost };
}

export async function executeCreateProductionOrder(params: {
  tenantId: string;
  userId: string;
  orderData: CreateProductionOrderInput;
  materialLines: ProductionMaterialLine[];
}) {
  const { tenantId, userId, orderData, materialLines } = params;
  const status = orderData.status || 'pending';
  const laborCost = orderData.laborCost ?? 0;
  const overheadCost = orderData.overheadCost ?? 0;
  const laborPaymentCategory = orderData.laborPaymentCategory || 'wages';
  const overheadPaymentCategory = orderData.overheadPaymentCategory || 'production_cost';
  const profile = await getPostingProfile(tenantId);

  return prisma.$transaction(
    async tx => {
      const order = await tx.productionOrder.create({
        data: {
          orderNumber: orderData.orderNumber,
          productId: orderData.productId,
          quantity: orderData.quantity,
          plannedQuantity: orderData.quantity,
          actualOutputQuantity: 0,
          remaining: orderData.quantity,
          cost: 0,
          status,
          date: orderData.date,
          notes: orderData.notes,
          productionLineId: orderData.productionLineId,
          tenantId,
          items: {
            create: materialLines.map(m => ({
              productId: m.productId,
              quantity: m.quantity,
              cost: 0,
              total: 0,
            })),
          },
        },
        include: { items: true, product: true, productionLine: true },
      });

      await tx.workInProgress.create({
        data: {
          productionOrderId: order.id,
          rawMaterialCost: 0,
          laborCost,
          overheadCost,
          totalCost: laborCost + overheadCost,
          cashboxId: orderData.cashboxId,
          laborPaymentCategory,
          overheadPaymentCategory,
          status: 'pending',
          tenantId,
        },
      });

      if (status === 'approved') {
        const costs = await consumeRawMaterialsInTx(tx, {
          tenantId,
          userId,
          productionOrderId: order.id,
          orderNumber: order.orderNumber,
          entryDate: order.date,
          items: materialLines,
          laborCost,
          overheadCost,
          cashboxId: orderData.cashboxId,
          laborPaymentCategory,
          overheadPaymentCategory,
          profile,
        });

        await tx.workInProgress.update({
          where: { productionOrderId: order.id },
          data: {
            rawMaterialCost: costs.rawMaterialCost,
            totalCost: costs.totalCost,
            status: 'in_progress',
          },
        });

        await tx.productionOrder.update({
          where: { id: order.id },
          data: { status: 'approved', cost: costs.totalCost },
        });
      }

      return tx.productionOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: {
          items: true,
          product: true,
          productionLine: true,
          workInProgress: true,
          productionWastes: true,
        },
      });
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 60000 },
  );
}

export async function executeApproveProductionOrder(params: {
  tenantId: string;
  userId: string;
  productionOrderId: string;
}) {
  const order = await prisma.productionOrder.findFirst({
    where: { id: params.productionOrderId, tenantId: params.tenantId },
    include: { items: true, workInProgress: true },
  });

  if (!order) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'أمر الإنتاج غير موجود');
  }
  if (order.status !== 'pending') {
    throw new InvoiceExecutionError(
      'VALIDATION_FAILED',
      `لا يمكن اعتماد أمر إنتاج حالته ${order.status}`,
    );
  }

  const wip = order.workInProgress;
  if (!wip) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'بيانات تكلفة أمر الإنتاج غير مكتملة');
  }

  const profile = await getPostingProfile(params.tenantId);
  const materialLines = order.items.map(i => ({
    productId: i.productId,
    quantity: i.quantity,
  }));

  return prisma.$transaction(
    async tx => {
      const costs = await consumeRawMaterialsInTx(tx, {
        tenantId: params.tenantId,
        userId: params.userId,
        productionOrderId: order.id,
        orderNumber: order.orderNumber,
        entryDate: order.date,
        items: materialLines,
        laborCost: wip.laborCost,
        overheadCost: wip.overheadCost,
        cashboxId: wip.cashboxId ?? undefined,
        laborPaymentCategory: wip.laborPaymentCategory || 'wages',
        overheadPaymentCategory: wip.overheadPaymentCategory || 'production_cost',
        profile,
      });

      await tx.workInProgress.update({
        where: { productionOrderId: order.id },
        data: {
          rawMaterialCost: costs.rawMaterialCost,
          totalCost: costs.totalCost,
          status: 'in_progress',
        },
      });

      const updated = await tx.productionOrder.update({
        where: { id: order.id },
        data: { status: 'approved', cost: costs.totalCost },
        include: { items: true, product: true, workInProgress: true, productionLine: true, productionWastes: true },
      });

      return updated;
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 60000 },
  );
}

export async function executeCompleteProductionOrder(params: {
  tenantId: string;
  userId: string;
  productionOrderId: string;
  actualOutputQuantity: number;
}) {
  const order = await prisma.productionOrder.findFirst({
    where: { id: params.productionOrderId, tenantId: params.tenantId },
    include: { workInProgress: true },
  });

  if (!order) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'أمر الإنتاج غير موجود');
  }
  if (order.status === 'completed') {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'أمر الإنتاج مكتمل بالفعل');
  }
  if (order.status !== 'waiting' && order.status !== 'approved') {
    throw new InvoiceExecutionError(
      'VALIDATION_FAILED',
      `لا يمكن إكمال أمر إنتاج حالته ${order.status}`,
    );
  }

  const outputQty = params.actualOutputQuantity;
  if (outputQty <= 0) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'كمية الإنتاج الفعلية يجب أن تكون أكبر من صفر');
  }

  const wip = order.workInProgress;
  if (!wip) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'بيانات تكلفة أمر الإنتاج غير مكتملة');
  }

  const profile = await getPostingProfile(params.tenantId);
  const plannedQty = order.plannedQuantity || order.quantity;
  const waste = Math.max(0, plannedQty - outputQty);
  const unitCost = outputQty > 0 ? wip.totalCost / outputQty : 0;

  return prisma.$transaction(
    async tx => {
      await assertCanPostReference(
        tx,
        params.tenantId,
        PRODUCTION_REF.COMPLETE,
        order.id,
      );

      const completeLines = buildProductionCompletionLines(wip.totalCost, params.tenantId, profile);
      await postJournalLinesInTransaction(tx, {
        tenantId: params.tenantId,
        userId: params.userId,
        entryDate: new Date(),
        description: `Production complete — ${order.orderNumber}`,
        referenceType: PRODUCTION_REF.COMPLETE,
        referenceId: order.id,
        lines: completeLines,
        correlationId: `${order.id}:complete`,
      });

      await applyProductionFinishedInflow(
        tx,
        params.tenantId,
        { productId: order.productId, quantity: outputQty, unitCost },
        order.id,
      );

      if (waste > 0) {
        await tx.productionWaste.create({
          data: {
            productId: order.productId,
            quantity: waste,
            date: new Date(),
            productionOrderId: order.id,
            notes: 'Variance on completion',
            tenantId: params.tenantId,
          },
        });

        await createAutoWasteStockAdjustmentInTx(tx, {
          tenantId: params.tenantId,
          productId: order.productId,
          productionOrderId: order.id,
          orderNumber: order.orderNumber,
          quantity: waste,
          date: new Date(),
          plannedQuantity: plannedQty,
          actualOutputQuantity: outputQty,
        });
      }

      await tx.workInProgress.update({
        where: { productionOrderId: order.id },
        data: { status: 'completed' },
      });

      return tx.productionOrder.update({
        where: { id: order.id },
        data: {
          status: 'completed',
          actualOutputQuantity: outputQty,
          produced: outputQty,
          remaining: 0,
          cost: wip.totalCost,
        },
        include: { items: true, product: true, workInProgress: true, productionLine: true, productionWastes: true },
      });
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 60000 },
  );
}

export async function executeCancelProductionOrder(params: {
  tenantId: string;
  userId: string;
  productionOrderId: string;
}) {
  const order = await prisma.productionOrder.findFirst({
    where: { id: params.productionOrderId, tenantId: params.tenantId },
    include: { items: true, workInProgress: true },
  });

  if (!order) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'Production order not found');
  }
  if (order.status === 'completed') {
    throw new InvoiceExecutionError(
      'VALIDATION_FAILED',
      'Cannot cancel a completed production order. Use a controlled reversal flow.',
    );
  }
  if (order.status === 'cancelled') {
    return order;
  }

  return prisma.$transaction(
    async tx => {
      await reverseJournalEntriesByReferenceId(tx, params.tenantId, order.id, 'ProductionOrder');
      await reverseInvoiceStockMovements(tx, params.tenantId, order.id, ['ProductionOrder']);
      await reverseCashboxTransactionsInTx(tx, {
        tenantId: params.tenantId,
        referenceType: PRODUCTION_COST_REF,
        referenceId: order.id,
        createdBy: params.userId,
      });
      await tx.stockAdjustment.deleteMany({
        where: {
          tenantId: params.tenantId,
          sourceType: AUTO_PRODUCTION_WASTE_ADJUSTMENT_REF,
          sourceId: order.id,
          applyToStock: false,
        },
      });
      await tx.productionWaste.deleteMany({ where: { productionOrderId: order.id } });
      await tx.workInProgress.updateMany({
        where: { productionOrderId: order.id },
        data: { status: 'cancelled' },
      });

      return tx.productionOrder.update({
        where: { id: order.id },
        data: {
          status: 'cancelled',
          actualOutputQuantity: 0,
          produced: 0,
          remaining: order.plannedQuantity || order.quantity,
        },
        include: { items: true, product: true, workInProgress: true, productionLine: true, productionWastes: true },
      });
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 60000 },
  );
}

export async function executeDeleteProductionOrder(params: {
  tenantId: string;
  userId: string;
  productionOrderId: string;
}) {
  const order = await prisma.productionOrder.findFirst({
    where: { id: params.productionOrderId, tenantId: params.tenantId },
    include: { items: true },
  });

  if (!order) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'Production order not found');
  }

  return prisma.$transaction(
    async tx => {
      await reverseJournalEntriesByReferenceId(tx, params.tenantId, order.id, 'ProductionOrder');
      await reverseInvoiceStockMovements(tx, params.tenantId, order.id, ['ProductionOrder']);
      await reverseCashboxTransactionsInTx(tx, {
        tenantId: params.tenantId,
        referenceType: PRODUCTION_COST_REF,
        referenceId: order.id,
        createdBy: params.userId,
      });
      await tx.stockAdjustment.deleteMany({
        where: {
          tenantId: params.tenantId,
          sourceType: AUTO_PRODUCTION_WASTE_ADJUSTMENT_REF,
          sourceId: order.id,
          applyToStock: false,
        },
      });

      await tx.productionWaste.deleteMany({ where: { productionOrderId: order.id } });
      await tx.workInProgress.deleteMany({ where: { productionOrderId: order.id } });
      await tx.productionOrderItem.deleteMany({ where: { productionOrderId: order.id } });
      await tx.productionOrder.delete({ where: { id: order.id } });

      return { id: order.id };
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 60000 },
  );
}

export function mapProductionError(error: unknown): {
  status: number;
  body: { error: string; code: string; details?: string };
} {
  if (error instanceof InvoiceExecutionError) {
    const statusMap: Record<InvoiceExecutionError['code'], number> = {
      VALIDATION_FAILED: 400,
      INVOICE_FAILED: 500,
      INVENTORY_FAILED: 409,
      ACCOUNTING_FAILED: 500,
    };
    return {
      status: statusMap[error.code],
      body: {
        error: toArabicError(error.message, 'فشلت عملية التصنيع، حاول مرة أخرى'),
        code: error.code,
        details: error.cause?.message ? toArabicError(error.cause.message, error.cause.message) : undefined,
      },
    };
  }
  return {
    status: 500,
    body: { error: toArabicError(error, 'فشلت عملية التصنيع، حاول مرة أخرى'), code: 'TRANSACTION_FAILED' },
  };
}
