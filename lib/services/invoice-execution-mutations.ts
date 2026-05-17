/**
 * Phase 5B — invoice update, cancel, return approval (canonical mutations).
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  InvoiceExecutionError,
  type ExecutionInvoiceItem,
  type SalesInvoiceExecutionInput,
  type PurchaseInvoiceExecutionInput,
} from '@/lib/services/invoice-execution.service';
import {
  computeInvoiceTotals,
  allocateFreightToLines,
  resolveInitialPayment,
  type InvoiceTotalsOptions,
} from '@/lib/utils/invoice-tax';
import { getPostingProfile } from '@/lib/services/accounting-posting-profile.service';
import {
  buildSalesInvoiceJournalLines,
  buildPurchaseInvoiceJournalLines,
  buildSalesReturnJournalLines,
  postJournalLinesInTransaction,
} from '@/lib/services/invoice-accounting.service';
import {
  assertInvoiceNotCancelled,
  assertCanPostInvoice,
  assertReturnNotAlreadyApproved,
  hasPostedJournalEntry,
  isPostedLifecycleStatus,
} from '@/lib/services/posting-guard.service';
import {
  applySalesOutflow,
  applyPurchaseInflow,
  applySalesReturnInflow,
  reverseInvoiceStockMovements,
} from '@/lib/services/inventory-movement.service';
import { reverseJournalEntriesInTx } from '@/lib/services/journal-reversal.service';
import { reversePaymentInTx } from '@/lib/services/payment-execution.service';

async function reverseInvoicePaymentsInTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  invoiceId: string,
  invoiceType: 'sales' | 'purchase',
): Promise<void> {
  const paymentIds = new Set<string>();
  const paymentField = invoiceType === 'sales' ? 'salesInvoiceId' : 'purchaseInvoiceId';

  const directPayments = await tx.payment.findMany({
    where: { [paymentField]: invoiceId, tenantId } as any,
    select: { id: true },
  });
  directPayments.forEach(p => paymentIds.add(p.id));

  const allocRows = await tx.paymentAllocation.findMany({
    where: {
      invoiceId,
      invoiceType: invoiceType === 'sales' ? 'sales' : 'purchase',
      tenantId,
    },
    select: { paymentId: true },
  });
  allocRows.forEach(a => paymentIds.add(a.paymentId));

  for (const paymentId of Array.from(paymentIds)) {
    await reversePaymentInTx(tx, tenantId, paymentId);
    await tx.payment.update({
      where: { id: paymentId },
      data:
        invoiceType === 'sales'
          ? { salesInvoiceId: null }
          : { purchaseInvoiceId: null },
    });
  }
}

function isDraft(status?: string) {
  return status === 'draft';
}

function totalsOpts(
  items: ExecutionInvoiceItem[],
  header: Omit<InvoiceTotalsOptions, 'lines'>,
): InvoiceTotalsOptions {
  return { lines: items, ...header };
}

export async function executeUpdateSalesInvoice(params: {
  invoiceId: string;
  tenantId: string;
  userId: string;
  invoiceData: Partial<SalesInvoiceExecutionInput>;
  items: ExecutionInvoiceItem[];
  republish?: boolean;
}) {
  const existing = await prisma.salesInvoice.findFirst({
    where: { id: params.invoiceId, tenantId: params.tenantId },
    include: { items: true },
  });
  if (!existing) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'Invoice not found');
  }
  await assertInvoiceNotCancelled(existing.status);

  const wasPosted = isPostedLifecycleStatus(existing.status);
  const willPost = !isDraft(params.invoiceData.status ?? existing.status);

  if (wasPosted && willPost && params.republish !== false) {
    return executeRepublishSalesInvoice(params, existing);
  }

  const totals = computeInvoiceTotals(
    totalsOpts(params.items, {
      headerDiscount: params.invoiceData.discount ?? existing.discount,
      headerDiscountPercent: params.invoiceData.discountPercent,
      headerTaxRate: params.invoiceData.taxRate,
      headerTaxAmount: params.invoiceData.tax,
      extraCharges: params.invoiceData.extraCharges,
      taxMode: params.invoiceData.taxMode,
    }),
  );

  const payment = resolveInitialPayment({
    paymentStatus: params.invoiceData.paymentStatus ?? existing.paymentStatus,
    grandTotal: totals.grandTotal,
    paidAmount: params.invoiceData.paidAmount ?? existing.paidAmount,
  });

  return prisma.$transaction(
    async tx => {
      await tx.salesInvoiceItem.deleteMany({ where: { salesInvoiceId: params.invoiceId } });

      const invoice = await tx.salesInvoice.update({
        where: { id: params.invoiceId },
        data: {
          customerId: params.invoiceData.customerId ?? existing.customerId,
          date: params.invoiceData.date ?? existing.date,
          notes: params.invoiceData.notes ?? existing.notes,
          status: params.invoiceData.status ?? existing.status,
          paymentStatus: payment.paymentStatus,
          paidAmount: payment.paidAmount,
          total: totals.subtotal,
          discount: totals.headerDiscount + totals.lineDiscountTotal,
          tax: totals.tax,
          grandTotal: totals.grandTotal,
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
        include: { items: true },
      });

      return { invoice, totals, republished: false };
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 30000 },
  );
}

async function executeRepublishSalesInvoice(
  params: {
    invoiceId: string;
    tenantId: string;
    userId: string;
    invoiceData: Partial<SalesInvoiceExecutionInput>;
    items: ExecutionInvoiceItem[];
  },
  existing: { id: string; invoiceNumber: string; date: Date; status: string },
) {
  const totals = computeInvoiceTotals(
    totalsOpts(params.items, {
      headerDiscount: params.invoiceData.discount,
      headerDiscountPercent: params.invoiceData.discountPercent,
      headerTaxRate: params.invoiceData.taxRate,
      headerTaxAmount: params.invoiceData.tax,
      extraCharges: params.invoiceData.extraCharges,
      taxMode: params.invoiceData.taxMode,
    }),
  );

  const profile = await getPostingProfile(params.tenantId);
  const invoiceNumber = params.invoiceData.invoiceNumber ?? existing.invoiceNumber;

  return prisma.$transaction(
    async tx => {
      await reverseJournalEntriesInTx(tx, params.tenantId, 'SalesInvoice', params.invoiceId);
      await reverseInvoiceStockMovements(tx, params.tenantId, params.invoiceId, ['SalesInvoice']);

      await tx.salesInvoiceItem.deleteMany({ where: { salesInvoiceId: params.invoiceId } });

      const payment = resolveInitialPayment({
        paymentStatus: params.invoiceData.paymentStatus,
        grandTotal: totals.grandTotal,
        paidAmount: params.invoiceData.paidAmount,
      });

      const invoice = await tx.salesInvoice.update({
        where: { id: params.invoiceId },
        data: {
          customerId: params.invoiceData.customerId,
          date: params.invoiceData.date ?? existing.date,
          notes: params.invoiceData.notes,
          status: params.invoiceData.status ?? 'posted',
          paymentStatus: payment.paymentStatus,
          paidAmount: payment.paidAmount,
          total: totals.subtotal,
          discount: totals.headerDiscount + totals.lineDiscountTotal,
          tax: totals.tax,
          grandTotal: totals.grandTotal,
          items: {
            create: totals.lines.map(l => ({
              productId: l.productId,
              quantity: l.quantity,
              price: l.price,
              total: l.total,
              discountPercent: l.discountPercent,
              taxRate: l.taxRate,
            })),
          },
        },
        include: { items: true },
      });

      let totalCogs = 0;
      if (!isDraft(invoice.status)) {
        await assertCanPostInvoice(tx, params.tenantId, 'SalesInvoice', params.invoiceId);

        for (const line of totals.lines) {
          totalCogs += await applySalesOutflow(
            tx,
            params.tenantId,
            { productId: line.productId, quantity: line.quantity },
            'SalesInvoice',
            params.invoiceId,
          );
        }

        const jeLines = buildSalesInvoiceJournalLines(
          {
            invoiceNumber,
            netSubtotal: totals.netSubtotal,
            tax: totals.tax,
            grandTotal: totals.grandTotal,
            totalCogs,
            tenantId: params.tenantId,
          },
          profile,
        );

        await postJournalLinesInTransaction(tx, {
          tenantId: params.tenantId,
          userId: params.userId,
          entryDate: invoice.date,
          description: `Sales Invoice ${invoiceNumber} (republished)`,
          referenceType: 'SalesInvoice',
          referenceId: params.invoiceId,
          lines: jeLines,
        });
      }

      return { invoice, totals, totalCogs, republished: true };
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 30000 },
  );
}

export async function executeDeleteSalesInvoice(params: {
  invoiceId: string;
  tenantId: string;
  userId: string;
}) {
  const invoice = await prisma.salesInvoice.findFirst({
    where: { id: params.invoiceId, tenantId: params.tenantId },
    include: { items: true },
  });
  if (!invoice) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'Invoice not found');
  }

  return prisma.$transaction(
    async tx => {
      const paymentIds = new Set<string>();

      const directPayments = await tx.payment.findMany({
        where: { salesInvoiceId: params.invoiceId, tenantId: params.tenantId },
        select: { id: true },
      });
      directPayments.forEach(p => paymentIds.add(p.id));

      const allocRows = await tx.paymentAllocation.findMany({
        where: { invoiceId: params.invoiceId, invoiceType: 'sales', tenantId: params.tenantId },
        select: { paymentId: true },
      });
      allocRows.forEach(a => paymentIds.add(a.paymentId));

      for (const paymentId of Array.from(paymentIds)) {
        await reversePaymentInTx(tx, params.tenantId, paymentId);
        await tx.payment.delete({ where: { id: paymentId } });
      }

      await tx.salesReturn.updateMany({
        where: { salesInvoiceId: params.invoiceId, tenantId: params.tenantId },
        data: { salesInvoiceId: null },
      });

      await reverseJournalEntriesInTx(tx, params.tenantId, 'SalesInvoice', params.invoiceId);
      await reverseInvoiceStockMovements(tx, params.tenantId, params.invoiceId, ['SalesInvoice']);

      await tx.salesInvoiceItem.deleteMany({ where: { salesInvoiceId: params.invoiceId } });
      await tx.salesInvoice.delete({ where: { id: params.invoiceId } });

      return { id: params.invoiceId, invoice };
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 60000 },
  );
}

export async function executeDeletePurchaseInvoice(params: {
  invoiceId: string;
  tenantId: string;
  userId: string;
}) {
  const invoice = await prisma.purchaseInvoice.findFirst({
    where: { id: params.invoiceId, tenantId: params.tenantId },
    include: { items: true },
  });
  if (!invoice) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'Invoice not found');
  }

  return prisma.$transaction(
    async tx => {
      const paymentIds = new Set<string>();

      const directPayments = await tx.payment.findMany({
        where: { purchaseInvoiceId: params.invoiceId, tenantId: params.tenantId },
        select: { id: true },
      });
      directPayments.forEach(p => paymentIds.add(p.id));

      const allocRows = await tx.paymentAllocation.findMany({
        where: { invoiceId: params.invoiceId, invoiceType: 'purchase', tenantId: params.tenantId },
        select: { paymentId: true },
      });
      allocRows.forEach(a => paymentIds.add(a.paymentId));

      for (const paymentId of Array.from(paymentIds)) {
        await reversePaymentInTx(tx, params.tenantId, paymentId);
        await tx.payment.delete({ where: { id: paymentId } });
      }

      await tx.purchaseReturn.updateMany({
        where: { purchaseInvoiceId: params.invoiceId, tenantId: params.tenantId },
        data: { purchaseInvoiceId: null },
      });

      await reverseJournalEntriesInTx(tx, params.tenantId, 'PurchaseInvoice', params.invoiceId);
      await reverseInvoiceStockMovements(tx, params.tenantId, params.invoiceId, ['PurchaseInvoice']);

      await tx.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: params.invoiceId } });
      await tx.purchaseInvoice.delete({ where: { id: params.invoiceId } });

      return { id: params.invoiceId, invoice };
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 60000 },
  );
}

export async function executeCancelSalesInvoice(params: {
  invoiceId: string;
  tenantId: string;
  userId: string;
}) {
  const existing = await prisma.salesInvoice.findFirst({
    where: { id: params.invoiceId, tenantId: params.tenantId },
  });
  if (!existing) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'Invoice not found');
  }

  return prisma.$transaction(async tx => {
    await reverseInvoicePaymentsInTx(tx, params.tenantId, params.invoiceId, 'sales');
    await reverseJournalEntriesInTx(tx, params.tenantId, 'SalesInvoice', params.invoiceId);
    await reverseInvoiceStockMovements(tx, params.tenantId, params.invoiceId, ['SalesInvoice']);

    const invoice = await tx.salesInvoice.update({
      where: { id: params.invoiceId },
      data: { status: 'cancelled', paymentStatus: 'cancelled', paidAmount: 0 },
    });

    return { invoice };
  });
}

export async function executeUpdatePurchaseInvoice(params: {
  invoiceId: string;
  tenantId: string;
  userId: string;
  invoiceData: Partial<PurchaseInvoiceExecutionInput>;
  items: ExecutionInvoiceItem[];
  republish?: boolean;
}) {
  const existing = await prisma.purchaseInvoice.findFirst({
    where: { id: params.invoiceId, tenantId: params.tenantId },
    include: { items: true },
  });
  if (!existing) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'Invoice not found');
  }
  await assertInvoiceNotCancelled(existing.status);

  const wasPosted = isPostedLifecycleStatus(existing.status);

  if (wasPosted && params.republish !== false) {
    let totals = computeInvoiceTotals(
      totalsOpts(params.items, {
        headerDiscount: params.invoiceData.discount,
        headerDiscountPercent: params.invoiceData.discountPercent,
        headerTaxRate: params.invoiceData.taxRate,
        headerTaxAmount: params.invoiceData.tax,
        extraCharges: params.invoiceData.extraCharges,
        freightAmount: params.invoiceData.freightAmount,
        taxMode: params.invoiceData.taxMode,
      }),
    );
    if (params.invoiceData.freightAmount && params.invoiceData.freightAmount > 0) {
      totals = { ...totals, lines: allocateFreightToLines(totals.lines, params.invoiceData.freightAmount) };
    }

    const profile = await getPostingProfile(params.tenantId);
    const inventoryValue = totals.netSubtotal + totals.freightAmount;

    return prisma.$transaction(async tx => {
      await reverseJournalEntriesInTx(tx, params.tenantId, 'PurchaseInvoice', params.invoiceId);
      await reverseInvoiceStockMovements(tx, params.tenantId, params.invoiceId, ['PurchaseInvoice']);

      await tx.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: params.invoiceId } });

      const invoice = await tx.purchaseInvoice.update({
        where: { id: params.invoiceId },
        data: {
          supplierId: params.invoiceData.supplierId ?? existing.supplierId,
          notes: params.invoiceData.notes,
          status: params.invoiceData.status ?? 'posted',
          total: totals.subtotal,
          discount: totals.headerDiscount + totals.lineDiscountTotal,
          tax: totals.tax,
          grandTotal: totals.grandTotal,
          items: {
            create: totals.lines.map(l => ({
              productId: l.productId,
              quantity: l.quantity,
              price: l.unitCost,
              total: l.quantity * l.unitCost,
              discountPercent: l.discountPercent,
              taxRate: l.taxRate,
            })),
          },
        },
        include: { items: true },
      });

      await assertCanPostInvoice(tx, params.tenantId, 'PurchaseInvoice', params.invoiceId);

      for (const line of totals.lines) {
        await applyPurchaseInflow(
          tx,
          params.tenantId,
          { productId: line.productId, quantity: line.quantity, unitCost: line.unitCost },
          'PurchaseInvoice',
          params.invoiceId,
        );
      }

      const jeLines = buildPurchaseInvoiceJournalLines(
        {
          invoiceNumber: existing.invoiceNumber,
          inventoryValue,
          tax: totals.tax,
          grandTotal: totals.grandTotal,
          tenantId: params.tenantId,
        },
        profile,
      );

      await postJournalLinesInTransaction(tx, {
        tenantId: params.tenantId,
        userId: params.userId,
        entryDate: invoice.date,
        description: `Purchase Invoice ${existing.invoiceNumber} (republished)`,
        referenceType: 'PurchaseInvoice',
        referenceId: params.invoiceId,
        lines: jeLines,
      });

      return { invoice, totals, republished: true };
    }, { isolationLevel: 'Serializable', maxWait: 15000, timeout: 30000 });
  }

  const totals = computeInvoiceTotals(
    totalsOpts(params.items, {
      headerDiscount: params.invoiceData.discount ?? existing.discount,
      headerDiscountPercent: params.invoiceData.discountPercent,
      headerTaxRate: params.invoiceData.taxRate,
      headerTaxAmount: params.invoiceData.tax,
      extraCharges: params.invoiceData.extraCharges,
      freightAmount: params.invoiceData.freightAmount,
      taxMode: params.invoiceData.taxMode,
    }),
  );

  return prisma.$transaction(async tx => {
    await tx.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: params.invoiceId } });
    const invoice = await tx.purchaseInvoice.update({
      where: { id: params.invoiceId },
      data: {
        supplierId: params.invoiceData.supplierId ?? existing.supplierId,
        notes: params.invoiceData.notes ?? existing.notes,
        status: params.invoiceData.status ?? existing.status,
        total: totals.subtotal,
        discount: totals.headerDiscount + totals.lineDiscountTotal,
        tax: totals.tax,
        grandTotal: totals.grandTotal,
        items: {
          create: totals.lines.map(l => ({
            productId: l.productId,
            quantity: l.quantity,
            price: l.unitCost,
            total: l.quantity * l.unitCost,
            discountPercent: l.discountPercent,
            taxRate: l.taxRate,
          })),
        },
      },
      include: { items: true },
    });
    return { invoice, totals, republished: false };
  });
}

export async function executeCancelPurchaseInvoice(params: {
  invoiceId: string;
  tenantId: string;
  userId: string;
}) {
  const existing = await prisma.purchaseInvoice.findFirst({
    where: { id: params.invoiceId, tenantId: params.tenantId },
  });
  if (!existing) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'Invoice not found');
  }

  return prisma.$transaction(async tx => {
    await reverseInvoicePaymentsInTx(tx, params.tenantId, params.invoiceId, 'purchase');
    await reverseJournalEntriesInTx(tx, params.tenantId, 'PurchaseInvoice', params.invoiceId);
    await reverseInvoiceStockMovements(tx, params.tenantId, params.invoiceId, ['PurchaseInvoice']);

    const invoice = await tx.purchaseInvoice.update({
      where: { id: params.invoiceId },
      data: { status: 'cancelled', paymentStatus: 'cancelled', paidAmount: 0 },
    });
    return { invoice };
  });
}

export async function executeApproveSalesReturnCanonical(params: {
  returnId: string;
  tenantId: string;
  userId: string;
}) {
  const salesReturn = await prisma.salesReturn.findFirst({
    where: { id: params.returnId, tenantId: params.tenantId },
    include: { items: true, salesInvoice: true },
  });
  if (!salesReturn) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'Sales return not found');
  }
  await assertReturnNotAlreadyApproved(salesReturn.status);

  if (await hasPostedJournalEntry(prisma, params.tenantId, 'SalesReturn', params.returnId)) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'Return already posted');
  }

  const profile = await getPostingProfile(params.tenantId);
  let totalCogs = 0;

  return prisma.$transaction(async tx => {
    for (const item of salesReturn.items) {
      const unitCost = item.price > 0 ? item.price : 0;
      totalCogs += await applySalesReturnInflow(
        tx,
        params.tenantId,
        { productId: item.productId, quantity: item.quantity, unitCost },
        salesReturn.id,
      );
    }

    const returnTotal = salesReturn.total;
    const jeLines = buildSalesReturnJournalLines(
      {
        returnNumber: salesReturn.returnNumber,
        netSubtotal: returnTotal,
        tax: 0,
        grandTotal: returnTotal,
        totalCogs,
        tenantId: params.tenantId,
      },
      profile,
    );

    const journalEntry = await postJournalLinesInTransaction(tx, {
      tenantId: params.tenantId,
      userId: params.userId,
      entryDate: salesReturn.date,
      description: `Sales Return ${salesReturn.returnNumber}`,
      referenceType: 'SalesReturn',
      referenceId: salesReturn.id,
      lines: jeLines,
    });

    if (salesReturn.salesInvoice) {
      const linked = salesReturn.salesInvoice;
      await tx.salesInvoice.update({
        where: { id: linked.id },
        data: {
          paidAmount: { decrement: Math.min(returnTotal, linked.paidAmount) },
          status: 'credited',
        },
      });
    }

    await tx.salesReturn.update({
      where: { id: salesReturn.id },
      data: { status: 'approved' },
    });

    return { salesReturn, journalEntry, totalCogs };
  });
}

export async function executeApprovePurchaseReturnCanonical(params: {
  returnId: string;
  tenantId: string;
  userId: string;
}) {
  const purchaseReturn = await prisma.purchaseReturn.findFirst({
    where: { id: params.returnId, tenantId: params.tenantId },
    include: { items: true, purchaseInvoice: true },
  });
  if (!purchaseReturn) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'Purchase return not found');
  }
  await assertReturnNotAlreadyApproved(purchaseReturn.status);

  if (await hasPostedJournalEntry(prisma, params.tenantId, 'PurchaseReturn', params.returnId)) {
    throw new InvoiceExecutionError('VALIDATION_FAILED', 'Return already posted');
  }

  const profile = await getPostingProfile(params.tenantId);
  let totalCogs = 0;

  return prisma.$transaction(async tx => {
    for (const item of purchaseReturn.items) {
      totalCogs += await applySalesOutflow(
        tx,
        params.tenantId,
        { productId: item.productId, quantity: item.quantity },
        'PurchaseReturn',
        purchaseReturn.id,
      );
    }

    const returnTotal = purchaseReturn.total;
    const jeLines = buildSalesReturnJournalLines(
      {
        returnNumber: purchaseReturn.returnNumber,
        netSubtotal: returnTotal,
        tax: 0,
        grandTotal: returnTotal,
        totalCogs,
        tenantId: params.tenantId,
      },
      profile,
    );

    const journalEntry = await postJournalLinesInTransaction(tx, {
      tenantId: params.tenantId,
      userId: params.userId,
      entryDate: purchaseReturn.date,
      description: `Purchase Return ${purchaseReturn.returnNumber}`,
      referenceType: 'PurchaseReturn',
      referenceId: purchaseReturn.id,
      lines: jeLines,
    });

    await tx.purchaseReturn.update({
      where: { id: purchaseReturn.id },
      data: { status: 'approved' },
    });

    return { purchaseReturn, journalEntry, totalCogs };
  });
}
