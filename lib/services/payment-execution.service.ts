/**
 * Canonical payment mutations — allocations + GL in one transaction.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { derivePaymentStatus } from '@/lib/utils/invoice-tax';
import {
  buildPaymentJournalLines,
  postJournalLinesInTransaction,
} from '@/lib/services/invoice-accounting.service';
import { getPostingProfile } from '@/lib/services/accounting-posting-profile.service';
import {
  getInvoiceOutstanding,
  getInvoiceOutstandingInTx,
} from '@/lib/services/party-balance.service';
import {
  reverseAllJournalEntriesForReferenceId,
} from '@/lib/services/journal-reversal.service';
import {
  recordCashboxTransactionInTx,
  reverseCashboxTransactionsInTx,
} from '@/lib/services/cashbox.service';

export class PaymentExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentExecutionError';
  }
}

export interface PaymentAllocationInput {
  invoiceId: string;
  invoiceType: 'sales' | 'purchase';
  amount: number;
}

const PAYMENT_REF = 'Payment';

async function applyAllocationsInTx(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    userId: string;
    paymentId: string;
    allocations: PaymentAllocationInput[];
  },
): Promise<void> {
  const { tenantId, userId, paymentId, allocations } = params;

  for (const alloc of allocations) {
    await tx.paymentAllocation.create({
      data: {
        paymentId,
        invoiceId: alloc.invoiceId,
        invoiceType: alloc.invoiceType,
        amount: alloc.amount,
        allocatedBy: userId,
        tenantId,
      },
    });

    if (alloc.invoiceType === 'sales') {
      const inv = await tx.salesInvoice.update({
        where: { id: alloc.invoiceId },
        data: { paidAmount: { increment: alloc.amount } },
      });
      const due = inv.grandTotal || inv.total;
      await tx.salesInvoice.update({
        where: { id: alloc.invoiceId },
        data: {
          paymentStatus: derivePaymentStatus({
            paidAmount: inv.paidAmount,
            grandTotal: due,
            invoiceDate: inv.date,
            paymentTermsDays: inv.paymentTermsDays,
          }),
        },
      });
    } else {
      const inv = await tx.purchaseInvoice.update({
        where: { id: alloc.invoiceId },
        data: { paidAmount: { increment: alloc.amount } },
      });
      const due = inv.grandTotal || inv.total;
      await tx.purchaseInvoice.update({
        where: { id: alloc.invoiceId },
        data: {
          paymentStatus: derivePaymentStatus({
            paidAmount: inv.paidAmount,
            grandTotal: due,
            invoiceDate: inv.date,
            paymentTermsDays: inv.paymentTermsDays,
          }),
        },
      });
    }
  }
}

async function rollbackAllocationsInTx(
  tx: Prisma.TransactionClient,
  paymentId: string,
): Promise<void> {
  const allocations = await tx.paymentAllocation.findMany({ where: { paymentId } });

  for (const alloc of allocations) {
    if (alloc.invoiceType === 'sales') {
      const inv = await tx.salesInvoice.update({
        where: { id: alloc.invoiceId },
        data: { paidAmount: { decrement: alloc.amount } },
      });
      const due = inv.grandTotal || inv.total;
      const paid = Math.max(0, inv.paidAmount);
      await tx.salesInvoice.update({
        where: { id: alloc.invoiceId },
        data: {
          paymentStatus:
            paid <= 0 ? 'unpaid' : paid >= due - 0.01 ? 'paid' : 'partial',
        },
      });
    } else {
      const inv = await tx.purchaseInvoice.update({
        where: { id: alloc.invoiceId },
        data: { paidAmount: { decrement: alloc.amount } },
      });
      const due = inv.grandTotal || inv.total;
      const paid = Math.max(0, inv.paidAmount);
      await tx.purchaseInvoice.update({
        where: { id: alloc.invoiceId },
        data: {
          paymentStatus:
            paid <= 0 ? 'unpaid' : paid >= due - 0.01 ? 'paid' : 'partial',
        },
      });
    }
  }

  await tx.paymentAllocation.deleteMany({ where: { paymentId } });
}

async function assertAllocationsWithinOutstandingInTx(
  tx: Prisma.TransactionClient,
  allocations: PaymentAllocationInput[],
): Promise<void> {
  for (const alloc of allocations) {
    const outstanding = await getInvoiceOutstandingInTx(
      tx,
      alloc.invoiceType,
      alloc.invoiceId,
    );
    if (alloc.amount > outstanding + 0.01) {
      throw new PaymentExecutionError(
        `المبلغ المخصص ${alloc.amount} يتجاوز المتبقي ${outstanding.toFixed(2)}`,
      );
    }
  }
}

export async function createPaymentInTx(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    userId: string;
    amount: number;
    date: Date;
    type: 'incoming' | 'outgoing';
    cashboxId: string;
    customerId?: string;
    supplierId?: string;
    salesInvoiceId?: string;
    purchaseInvoiceId?: string;
    notes?: string;
    allocations: PaymentAllocationInput[];
  },
) {
  const { tenantId, userId, amount, date, type } = params;
  if (amount <= 0) throw new PaymentExecutionError('المبلغ يجب أن يكون أكبر من صفر');
  if (!params.cashboxId) throw new PaymentExecutionError('يجب اختيار الخزنة عند تسجيل مبلغ مدفوع');
  if (!params.allocations.length) throw new PaymentExecutionError('يجب ربط الدفعة بفاتورة واحدة على الأقل');

  const allocSum = params.allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(allocSum - amount) > 0.02) {
    throw new PaymentExecutionError('إجمالي المبالغ المخصصة يجب أن يساوي مبلغ الدفعة');
  }

  await assertAllocationsWithinOutstandingInTx(tx, params.allocations);

  const payment = await tx.payment.create({
    data: {
      amount,
      date,
      type,
      customerId: params.customerId,
      supplierId: params.supplierId,
      salesInvoiceId: params.salesInvoiceId,
      purchaseInvoiceId: params.purchaseInvoiceId,
      cashboxId: params.cashboxId,
      notes: params.notes,
      tenantId,
    },
  });

  await applyAllocationsInTx(tx, {
    tenantId,
    userId,
    paymentId: payment.id,
    allocations: params.allocations,
  });

  await recordCashboxTransactionInTx(tx, {
    tenantId,
    cashboxId: params.cashboxId,
    type: type === 'incoming' ? 'sales_receipt' : 'purchase_payment',
    direction: type === 'incoming' ? 'in' : 'out',
    amount,
    date,
    referenceType: PAYMENT_REF,
    referenceId: payment.id,
    description: params.notes || (type === 'incoming' ? 'تحصيل فاتورة مبيعات' : 'سداد فاتورة مشتريات'),
    createdBy: userId,
  });

  const journalEntryId = await postPaymentJournalInTx(tx, {
    tenantId,
    userId,
    paymentId: payment.id,
    amount,
    type,
    date,
  });

  return {
    payment: await tx.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: { allocations: true },
    }),
    journalEntry: { id: journalEntryId },
  };
}

export async function reversePaymentInTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  paymentId: string,
): Promise<void> {
  await reverseAllJournalEntriesForReferenceId(tx, tenantId, paymentId, PAYMENT_REF);
  await reverseCashboxTransactionsInTx(tx, {
    tenantId,
    referenceType: PAYMENT_REF,
    referenceId: paymentId,
  });
  await rollbackAllocationsInTx(tx, paymentId);
  await tx.payment.update({
    where: { id: paymentId },
    data: { journalEntryId: null, reconciled: false, reconciledAt: null },
  });
}

async function postPaymentJournalInTx(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    userId: string;
    paymentId: string;
    amount: number;
    type: 'incoming' | 'outgoing';
    date: Date;
  },
): Promise<string> {
  const profile = await getPostingProfile(params.tenantId);
  const correlationId = `${params.paymentId}:post`;

  const jeLines = buildPaymentJournalLines(
    {
      amount: params.amount,
      type: params.type,
      tenantId: params.tenantId,
      reference: params.paymentId,
    },
    profile,
  );

  const journalEntry = await postJournalLinesInTransaction(tx, {
    tenantId: params.tenantId,
    userId: params.userId,
    entryDate: params.date,
    description: `Payment ${params.type} ${params.paymentId}`,
    referenceType: PAYMENT_REF,
    referenceId: params.paymentId,
    lines: jeLines,
    correlationId,
  });

  await tx.payment.update({
    where: { id: params.paymentId },
    data: {
      journalEntryId: journalEntry.id,
      reconciled: true,
      reconciledAt: new Date(),
    },
  });

  return journalEntry.id;
}

export async function executeCreatePayment(params: {
  tenantId: string;
  userId: string;
  amount: number;
  date: Date;
  type: 'incoming' | 'outgoing';
  customerId?: string;
  supplierId?: string;
  salesInvoiceId?: string;
  purchaseInvoiceId?: string;
  cashboxId?: string;
  notes?: string;
  allocations?: PaymentAllocationInput[];
}) {
  const { tenantId, userId, amount, date, type } = params;

  if (amount <= 0) throw new PaymentExecutionError('المبلغ يجب أن يكون أكبر من صفر');
  if (!params.cashboxId) throw new PaymentExecutionError('يجب اختيار الخزنة عند تسجيل مبلغ مدفوع');

  const allocations: PaymentAllocationInput[] = params.allocations?.length
    ? params.allocations
    : params.salesInvoiceId
      ? [{ invoiceId: params.salesInvoiceId, invoiceType: 'sales', amount }]
      : params.purchaseInvoiceId
        ? [{ invoiceId: params.purchaseInvoiceId, invoiceType: 'purchase', amount }]
        : [];

  if (allocations.length === 0) {
    throw new PaymentExecutionError('يجب ربط الدفعة بفاتورة واحدة على الأقل');
  }

  const allocSum = allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(allocSum - amount) > 0.02) {
    throw new PaymentExecutionError('إجمالي المبالغ المخصصة يجب أن يساوي مبلغ الدفعة');
  }

  for (const alloc of allocations) {
    const outstanding = await getInvoiceOutstanding(alloc.invoiceType, alloc.invoiceId);
    if (alloc.amount > outstanding + 0.01) {
      throw new PaymentExecutionError(
        `المبلغ المخصص ${alloc.amount} يتجاوز المتبقي ${outstanding.toFixed(2)}`,
      );
    }
  }

  return prisma.$transaction(
    async tx => {
      return createPaymentInTx(tx, {
        tenantId,
        userId,
        amount,
        date,
        type,
        cashboxId: params.cashboxId!,
        customerId: params.customerId,
        supplierId: params.supplierId,
        salesInvoiceId: params.salesInvoiceId,
        purchaseInvoiceId: params.purchaseInvoiceId,
        notes: params.notes,
        allocations,
      });
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 30000 },
  );
}

export async function executeUpdatePayment(params: {
  tenantId: string;
  userId: string;
  paymentId: string;
  amount?: number;
  date?: Date;
  type?: 'incoming' | 'outgoing';
  notes?: string;
  allocations?: PaymentAllocationInput[];
  cashboxId?: string;
}) {
  const existing = await prisma.payment.findFirst({
    where: { id: params.paymentId, tenantId: params.tenantId },
    include: { allocations: true },
  });
  if (!existing) throw new PaymentExecutionError('الدفعة غير موجودة');

  const amount = params.amount ?? existing.amount;
  const date = params.date ?? existing.date;
  const type = (params.type ?? existing.type) as 'incoming' | 'outgoing';

  const allocations: PaymentAllocationInput[] =
    params.allocations?.length
      ? params.allocations
      : existing.allocations.length > 0
        ? existing.allocations.map(a => ({
            invoiceId: a.invoiceId,
            invoiceType: a.invoiceType as 'sales' | 'purchase',
            amount: params.amount != null ? (a.amount / existing.amount) * amount : a.amount,
          }))
        : existing.salesInvoiceId
          ? [{ invoiceId: existing.salesInvoiceId, invoiceType: 'sales' as const, amount }]
          : existing.purchaseInvoiceId
            ? [{ invoiceId: existing.purchaseInvoiceId, invoiceType: 'purchase' as const, amount }]
            : [];

  if (allocations.length === 0) {
    throw new PaymentExecutionError('يجب أن تظل الدفعة مرتبطة بفاتورة واحدة على الأقل');
  }

  const allocSum = allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(allocSum - amount) > 0.02) {
    throw new PaymentExecutionError('إجمالي المبالغ المخصصة يجب أن يساوي مبلغ الدفعة');
  }

  return prisma.$transaction(
    async tx => {
      await reversePaymentInTx(tx, params.tenantId, params.paymentId);
      await assertAllocationsWithinOutstandingInTx(tx, allocations);

      const payment = await tx.payment.update({
        where: { id: params.paymentId },
        data: {
          amount,
          date,
          type,
          ...(params.notes !== undefined && { notes: params.notes }),
          ...(params.cashboxId !== undefined && { cashboxId: params.cashboxId }),
        },
      });

      await applyAllocationsInTx(tx, {
        tenantId: params.tenantId,
        userId: params.userId,
        paymentId: params.paymentId,
        allocations,
      });
      await recordCashboxTransactionInTx(tx, {
        tenantId: params.tenantId,
        cashboxId: params.cashboxId ?? (existing as any).cashboxId,
        type: type === 'incoming' ? 'sales_receipt' : 'purchase_payment',
        direction: type === 'incoming' ? 'in' : 'out',
        amount,
        date,
        referenceType: PAYMENT_REF,
        referenceId: params.paymentId,
        description: params.notes || (type === 'incoming' ? 'تحصيل فاتورة مبيعات' : 'سداد فاتورة مشتريات'),
        createdBy: params.userId,
      });

      const journalEntryId = await postPaymentJournalInTx(tx, {
        tenantId: params.tenantId,
        userId: params.userId,
        paymentId: params.paymentId,
        amount,
        type,
        date,
      });

      return {
        payment: await tx.payment.findUniqueOrThrow({
          where: { id: payment.id },
          include: { allocations: true },
        }),
        journalEntry: { id: journalEntryId },
      };
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 30000 },
  );
}

export async function executeReversePayment(params: {
  tenantId: string;
  userId: string;
  paymentId: string;
}) {
  const existing = await prisma.payment.findFirst({
    where: { id: params.paymentId, tenantId: params.tenantId },
  });
  if (!existing) throw new PaymentExecutionError('الدفعة غير موجودة');

  return prisma.$transaction(
    async tx => {
      await reversePaymentInTx(tx, params.tenantId, params.paymentId);
      const payment = await tx.payment.update({
        where: { id: params.paymentId },
        data: {
          notes: existing.notes
            ? `${existing.notes} [reversed]`
            : '[reversed]',
        },
      });
      return { payment };
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 30000 },
  );
}

export async function executeDeletePayment(params: {
  tenantId: string;
  userId: string;
  paymentId: string;
}) {
  const existing = await prisma.payment.findFirst({
    where: { id: params.paymentId, tenantId: params.tenantId },
  });
  if (!existing) throw new PaymentExecutionError('الدفعة غير موجودة');

  return prisma.$transaction(
    async tx => {
      await reversePaymentInTx(tx, params.tenantId, params.paymentId);
      await reverseAllJournalEntriesForReferenceId(
        tx,
        params.tenantId,
        params.paymentId,
        PAYMENT_REF,
      );
      await tx.payment.delete({ where: { id: params.paymentId } });
      return { id: params.paymentId };
    },
    { isolationLevel: 'Serializable', maxWait: 15000, timeout: 30000 },
  );
}
