/**
 * Canonical invoice execution — sales, purchases, returns.
 * All stock + costing + accounting in one Prisma transaction.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getPostingProfile } from '@/lib/services/accounting-posting-profile.service';
import { assertCanPostInvoice } from '@/lib/services/posting-guard.service';
import {
  applySalesOutflow,
  applyPurchaseInflow,
} from '@/lib/services/inventory-movement.service';
import {
  computeInvoiceTotals,
  allocateFreightToLines,
  resolveInitialPayment,
  type InvoiceLineInput,
  type InvoiceTotalsOptions,
} from '@/lib/utils/invoice-tax';
import {
  buildSalesInvoiceJournalLines,
  buildPurchaseInvoiceJournalLines,
  buildSalesReturnJournalLines,
  postJournalLinesInTransaction,
} from '@/lib/services/invoice-accounting.service';
import { createPaymentInTx } from '@/lib/services/payment-execution.service';

import { InvoiceExecutionError } from '@/lib/services/execution-errors';
export { InvoiceExecutionError };

export type ExecutionInvoiceItem = InvoiceLineInput;

export interface SalesInvoiceExecutionInput {
  invoiceNumber: string;
  date: Date;
  customerId: string;
  notes?: string;
  status?: string;
  paymentStatus?: string;
  paidAmount?: number;
  cashboxId?: string;
  paymentTermsDays?: number;
  issueDate?: Date;
  salesRepId?: string;
  currency?: string;
  template?: string;
  salesOrderId?: string;
  discount?: number;
  discountPercent?: number;
  taxRate?: number;
  tax?: number;
  extraCharges?: number;
  taxMode?: 'exclusive' | 'inclusive';
}

export interface PurchaseInvoiceExecutionInput {
  invoiceNumber: string;
  date: Date;
  supplierId: string;
  notes?: string;
  status?: string;
  paymentStatus?: string;
  paidAmount?: number;
  cashboxId?: string;
  paymentTermsDays?: number;
  issueDate?: Date;
  purchaseRepId?: string;
  currency?: string;
  template?: string;
  discount?: number;
  discountPercent?: number;
  taxRate?: number;
  tax?: number;
  extraCharges?: number;
  freightAmount?: number;
  taxMode?: 'exclusive' | 'inclusive';
}

function totalsOptions(
  items: ExecutionInvoiceItem[],
  header: {
    discount?: number;
    discountPercent?: number;
    taxRate?: number;
    tax?: number;
    extraCharges?: number;
    freightAmount?: number;
    taxMode?: 'exclusive' | 'inclusive';
  },
): InvoiceTotalsOptions {
  return {
    lines: items,
    headerDiscount: header.discount,
    headerDiscountPercent: header.discountPercent,
    headerTaxRate: header.taxRate,
    headerTaxAmount: header.tax,
    extraCharges: header.extraCharges,
    freightAmount: header.freightAmount,
    taxMode: header.taxMode,
  };
}

function isDraftStatus(status?: string): boolean {
  return status === 'draft';
}

async function assertUniqueInvoiceNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  invoiceNumber: string,
  kind: 'sales' | 'purchase',
): Promise<void> {
  const existing =
    kind === 'sales'
      ? await tx.salesInvoice.findFirst({ where: { invoiceNumber, tenantId } })
      : await tx.purchaseInvoice.findFirst({ where: { invoiceNumber, tenantId } });
  if (existing) {
    throw new InvoiceExecutionError(
      'VALIDATION_FAILED',
      `رقم الفاتورة ${invoiceNumber} مستخدم بالفعل`,
    );
  }
}

export async function executeCreateSalesInvoice(params: {
  invoiceData: SalesInvoiceExecutionInput;
  items: ExecutionInvoiceItem[];
  tenantId: string;
  userId: string;
}) {
  const { invoiceData, items, tenantId, userId } = params;
  if (!items?.length) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'يجب أن تحتوي الفاتورة على صنف واحد على الأقل');
  }

  const totals = computeInvoiceTotals(
    totalsOptions(items, {
      discount: invoiceData.discount,
      discountPercent: invoiceData.discountPercent,
      taxRate: invoiceData.taxRate,
      tax: invoiceData.tax,
      extraCharges: invoiceData.extraCharges,
      taxMode: invoiceData.taxMode,
    }),
  );

  const requestedPaidAmount = Number(invoiceData.paidAmount || 0);
  if (requestedPaidAmount < 0) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'المبلغ المدفوع لا يمكن أن يكون أقل من صفر');
  }
  if (requestedPaidAmount > totals.grandTotal + 0.01) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'المبلغ المدفوع لا يمكن أن يتجاوز إجمالي الفاتورة');
  }
  if (requestedPaidAmount > 0 && !invoiceData.cashboxId) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'يجب اختيار الخزنة عند تسجيل مبلغ مدفوع');
  }

  const payment = resolveInitialPayment({
    paymentStatus: invoiceData.paymentStatus,
    grandTotal: totals.grandTotal,
    paidAmount: requestedPaidAmount,
  });
  const effectivePaidAmount = payment.paidAmount;
  if (effectivePaidAmount > 0 && !invoiceData.cashboxId) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'يجب اختيار الخزنة عند تسجيل مبلغ مدفوع');
  }

  const postInventory = !isDraftStatus(invoiceData.status);
  const profile = await getPostingProfile(tenantId);

  return prisma.$transaction(
    async tx => {
      await assertUniqueInvoiceNumber(tx, tenantId, invoiceData.invoiceNumber, 'sales');

      const invoice = await tx.salesInvoice.create({
        data: {
          invoiceNumber: invoiceData.invoiceNumber,
          date: invoiceData.date,
          issueDate: invoiceData.issueDate,
          customerId: invoiceData.customerId,
          salesRepId: invoiceData.salesRepId,
          paymentTermsDays: invoiceData.paymentTermsDays ?? 0,
          currency: invoiceData.currency ?? 'EGP',
          template: invoiceData.template ?? 'default',
          salesOrderId: invoiceData.salesOrderId,
          notes: invoiceData.notes,
          status: invoiceData.status || 'posted',
          paymentStatus: payment.paymentStatus,
          // Keep invoice paidAmount at zero before creating the atomic payment,
          // then allocations update it once the payment is posted.
          paidAmount: effectivePaidAmount > 0 ? 0 : effectivePaidAmount,
          total: totals.subtotal,
          discount: totals.headerDiscount + totals.lineDiscountTotal,
          tax: totals.tax,
          grandTotal: totals.grandTotal,
          tenantId,
          items: {
            create: totals.lines.map(l => ({
              productId: l.productId,
              quantity: l.quantity,
              price: l.price,
              total: l.total,
              discountPercent: l.discountPercent,
              taxRate: l.taxRate,
              description: l.description ?? null,
            })),
          },
        },
        include: { items: true, customer: true },
      });

      let totalCogs = 0;
      let journalEntry: { id: string } | null = null;

      if (postInventory) {
        await assertCanPostInvoice(tx, tenantId, 'SalesInvoice', invoice.id);

        for (const line of totals.lines) {
          totalCogs += await applySalesOutflow(
            tx,
            tenantId,
            { productId: line.productId, quantity: line.quantity },
            'SalesInvoice',
            invoice.id,
          );
        }

        const jeLines = buildSalesInvoiceJournalLines(
          {
            invoiceNumber: invoiceData.invoiceNumber,
            netSubtotal: totals.netSubtotal,
            tax: totals.tax,
            grandTotal: totals.grandTotal,
            totalCogs,
            tenantId,
          },
          profile,
        );
        journalEntry = await postJournalLinesInTransaction(tx, {
          tenantId,
          userId,
          entryDate: invoiceData.date,
          description: `Sales Invoice ${invoiceData.invoiceNumber}`,
          referenceType: 'SalesInvoice',
          referenceId: invoice.id,
          lines: jeLines,
        });
      }

      let paymentResult: Awaited<ReturnType<typeof createPaymentInTx>> | null = null;
      let finalInvoice = invoice;
      if (effectivePaidAmount > 0) {
        paymentResult = await createPaymentInTx(tx, {
          tenantId,
          userId,
          amount: effectivePaidAmount,
          date: invoiceData.date,
          type: 'incoming',
          customerId: invoiceData.customerId,
          salesInvoiceId: invoice.id,
          cashboxId: invoiceData.cashboxId!,
          notes: `تحصيل مباشر من فاتورة ${invoice.invoiceNumber}`,
          allocations: [{ invoiceId: invoice.id, invoiceType: 'sales', amount: effectivePaidAmount }],
        });
        finalInvoice = await tx.salesInvoice.findUniqueOrThrow({
          where: { id: invoice.id },
          include: { items: true, customer: true, payments: true },
        });
      }

      return { invoice: finalInvoice, journalEntry, payment: paymentResult?.payment ?? null, totals, totalCogs, itemsProcessed: items.length };
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 30000 },
  );
}

export async function executeCreatePurchaseInvoice(params: {
  invoiceData: PurchaseInvoiceExecutionInput;
  items: ExecutionInvoiceItem[];
  tenantId: string;
  userId: string;
}) {
  const { invoiceData, items, tenantId, userId } = params;
  if (!items?.length) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'يجب أن تحتوي الفاتورة على صنف واحد على الأقل');
  }

  let totals = computeInvoiceTotals(
    totalsOptions(items, {
      discount: invoiceData.discount,
      discountPercent: invoiceData.discountPercent,
      taxRate: invoiceData.taxRate,
      tax: invoiceData.tax,
      extraCharges: invoiceData.extraCharges,
      freightAmount: invoiceData.freightAmount,
      taxMode: invoiceData.taxMode,
    }),
  );

  if (invoiceData.freightAmount && invoiceData.freightAmount > 0) {
    totals = {
      ...totals,
      lines: allocateFreightToLines(totals.lines, invoiceData.freightAmount, 'value'),
    };
  }

  const requestedPaidAmount = Number(invoiceData.paidAmount || 0);
  if (requestedPaidAmount < 0) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'المبلغ المدفوع لا يمكن أن يكون أقل من صفر');
  }
  if (requestedPaidAmount > totals.grandTotal + 0.01) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'المبلغ المدفوع لا يمكن أن يتجاوز إجمالي الفاتورة');
  }
  if (requestedPaidAmount > 0 && !invoiceData.cashboxId) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'يجب اختيار الخزنة عند تسجيل مبلغ مدفوع');
  }

  const payment = resolveInitialPayment({
    paymentStatus: invoiceData.paymentStatus,
    grandTotal: totals.grandTotal,
    paidAmount: requestedPaidAmount,
  });
  const effectivePaidAmount = payment.paidAmount;
  if (effectivePaidAmount > 0 && !invoiceData.cashboxId) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'يجب اختيار الخزنة عند تسجيل مبلغ مدفوع');
  }

  const postInventory = !isDraftStatus(invoiceData.status);
  const inventoryValue = totals.netSubtotal + totals.freightAmount;
  const profile = await getPostingProfile(tenantId);

  return prisma.$transaction(
    async tx => {
      await assertUniqueInvoiceNumber(tx, tenantId, invoiceData.invoiceNumber, 'purchase');

      const invoice = await tx.purchaseInvoice.create({
        data: {
          invoiceNumber: invoiceData.invoiceNumber,
          date: invoiceData.date,
          issueDate: invoiceData.issueDate,
          supplierId: invoiceData.supplierId,
          purchaseRepId: invoiceData.purchaseRepId,
          paymentTermsDays: invoiceData.paymentTermsDays ?? 0,
          currency: invoiceData.currency ?? 'EGP',
          template: invoiceData.template ?? 'default',
          notes: invoiceData.notes,
          status: invoiceData.status || 'posted',
          paymentStatus: payment.paymentStatus,
          // Keep invoice paidAmount at zero before creating the atomic payment,
          // then allocations update it once the payment is posted.
          paidAmount: effectivePaidAmount > 0 ? 0 : effectivePaidAmount,
          total: totals.subtotal,
          discount: totals.headerDiscount + totals.lineDiscountTotal,
          tax: totals.tax,
          grandTotal: totals.grandTotal,
          tenantId,
          items: {
            create: totals.lines.map(l => ({
              productId: l.productId,
              quantity: l.quantity,
              price: l.unitCost,
              total: l.quantity * l.unitCost,
              discountPercent: l.discountPercent,
              taxRate: l.taxRate,
              description: l.description ?? null,
            })),
          },
        },
        include: { items: true, supplier: true },
      });

      let journalEntry: { id: string } | null = null;

      if (postInventory) {
        await assertCanPostInvoice(tx, tenantId, 'PurchaseInvoice', invoice.id);

        for (const line of totals.lines) {
          await applyPurchaseInflow(
            tx,
            tenantId,
            { productId: line.productId, quantity: line.quantity, unitCost: line.unitCost },
            'PurchaseInvoice',
            invoice.id,
          );
        }

        const jeLines = buildPurchaseInvoiceJournalLines(
          {
            invoiceNumber: invoiceData.invoiceNumber,
            inventoryValue,
            tax: totals.tax,
            grandTotal: totals.grandTotal,
            tenantId,
          },
          profile,
        );
        journalEntry = await postJournalLinesInTransaction(tx, {
          tenantId,
          userId,
          entryDate: invoiceData.date,
          description: `Purchase Invoice ${invoiceData.invoiceNumber}`,
          referenceType: 'PurchaseInvoice',
          referenceId: invoice.id,
          lines: jeLines,
        });
      }

      let paymentResult: Awaited<ReturnType<typeof createPaymentInTx>> | null = null;
      let finalInvoice = invoice;
      if (effectivePaidAmount > 0) {
        paymentResult = await createPaymentInTx(tx, {
          tenantId,
          userId,
          amount: effectivePaidAmount,
          date: invoiceData.date,
          type: 'outgoing',
          supplierId: invoiceData.supplierId,
          purchaseInvoiceId: invoice.id,
          cashboxId: invoiceData.cashboxId!,
          notes: `سداد مباشر من فاتورة ${invoice.invoiceNumber}`,
          allocations: [{ invoiceId: invoice.id, invoiceType: 'purchase', amount: effectivePaidAmount }],
        });
        finalInvoice = await tx.purchaseInvoice.findUniqueOrThrow({
          where: { id: invoice.id },
          include: { items: true, supplier: true, payments: true },
        });
      }

      return { invoice: finalInvoice, journalEntry, payment: paymentResult?.payment ?? null, totals, itemsProcessed: items.length };
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 30000 },
  );
}

export {
  executeUpdateSalesInvoice,
  executeUpdatePurchaseInvoice,
  executeCancelSalesInvoice,
  executeCancelPurchaseInvoice,
  executeDeleteSalesInvoice,
  executeDeletePurchaseInvoice,
  executeDeleteInvoice,
  executeApproveSalesReturnCanonical as executeApproveSalesReturn,
  executeApprovePurchaseReturnCanonical as executeApprovePurchaseReturn,
} from '@/lib/services/invoice-execution-mutations';

export function mapExecutionError(error: unknown): {
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
      body: { error: error.message, code: error.code, details: error.cause?.message },
    };
  }
  return {
    status: 500,
    body: { error: 'فشلت العملية، حاول مرة أخرى', code: 'TRANSACTION_FAILED' },
  };
}

/** Backward-compatible aliases for Phase 4A atomic imports. */
export const TransactionError = InvoiceExecutionError;

export async function createSalesInvoiceAtomic(params: {
  invoiceData: SalesInvoiceExecutionInput & { dueDate?: Date };
  items: ExecutionInvoiceItem[];
  tenantId: string;
  userId: string;
}) {
  return executeCreateSalesInvoice(params);
}

export async function createPurchaseInvoiceAtomic(params: {
  invoiceData: PurchaseInvoiceExecutionInput & { dueDate?: Date };
  items: ExecutionInvoiceItem[];
  tenantId: string;
  userId: string;
}) {
  return executeCreatePurchaseInvoice(params);
}

export function handleTransactionError(error: unknown) {
  return mapExecutionError(error);
}
