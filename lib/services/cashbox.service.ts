import type { Prisma } from '@prisma/client';
import { CODE_ENTITY_KEYS, allocateEntityCode } from '@/lib/code-sequence.service';

export class CashboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CashboxError';
  }
}

export async function recordCashboxTransactionInTx(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    cashboxId: string;
    type: string;
    direction: 'in' | 'out';
    amount: number;
    date?: Date;
    referenceType?: string;
    referenceId?: string;
    description?: string;
    createdBy?: string;
  },
) {
  const amount = Number(params.amount);
  if (!params.cashboxId) throw new CashboxError('يجب اختيار الخزنة');
  if (!Number.isFinite(amount) || amount <= 0) throw new CashboxError('مبلغ حركة الخزنة يجب أن يكون أكبر من صفر');

  const cashbox = await (tx as any).cashbox.findFirst({
    where: { id: params.cashboxId, tenantId: params.tenantId },
    select: { id: true, status: true, currentBalance: true },
  });
  if (!cashbox) throw new CashboxError('الخزنة غير موجودة');
  if (cashbox.status !== 'active') throw new CashboxError('الخزنة غير نشطة');

  const delta = params.direction === 'in' ? amount : -amount;
  const beforeBalance = Number(cashbox.currentBalance || 0);
  const afterBalance = beforeBalance + delta;
  if (params.direction === 'out' && afterBalance < -0.01) {
    throw new CashboxError('رصيد الخزنة غير كافٍ لإتمام العملية');
  }

  await (tx as any).cashbox.update({
    where: { id: params.cashboxId },
    data: { currentBalance: { increment: delta } },
  });

  return (tx as any).cashboxTransaction.create({
    data: {
      cashboxId: params.cashboxId,
      tenantId: params.tenantId,
      type: params.type,
      direction: params.direction,
      amount,
      beforeBalance,
      afterBalance,
      date: params.date ?? new Date(),
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      description: params.description,
      createdBy: params.createdBy,
    },
  });
}

export async function reverseCashboxTransactionsInTx(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    referenceType: string;
    referenceId: string;
    createdBy?: string;
  },
) {
  const rows = await (tx as any).cashboxTransaction.findMany({
    where: {
      tenantId: params.tenantId,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
    },
  });

  for (const row of rows) {
    await recordCashboxTransactionInTx(tx, {
      tenantId: params.tenantId,
      cashboxId: row.cashboxId,
      type: `${row.type}_reversal`,
      direction: row.direction === 'in' ? 'out' : 'in',
      amount: row.amount,
      date: new Date(),
      referenceType: `${params.referenceType}Reversal`,
      referenceId: params.referenceId,
      description: `عكس حركة خزنة مرتبطة بالمرجع ${params.referenceId}`,
      createdBy: params.createdBy,
    });
  }
}

export async function transferBetweenCashboxesInTx(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    fromCashboxId: string;
    toCashboxId: string;
    amount: number;
    date?: Date;
    description?: string;
    createdBy?: string;
  },
) {
  const amount = Number(params.amount);
  if (!params.fromCashboxId || !params.toCashboxId) {
    throw new CashboxError('يجب اختيار خزنة المصدر وخزنة الوجهة');
  }
  if (params.fromCashboxId === params.toCashboxId) {
    throw new CashboxError('لا يمكن التحويل لنفس الخزنة');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new CashboxError('مبلغ التحويل يجب أن يكون أكبر من صفر');
  }

  const [fromCashbox, toCashbox] = await Promise.all([
    (tx as any).cashbox.findFirst({ where: { id: params.fromCashboxId, tenantId: params.tenantId } }),
    (tx as any).cashbox.findFirst({ where: { id: params.toCashboxId, tenantId: params.tenantId } }),
  ]);
  if (!fromCashbox || !toCashbox) throw new CashboxError('الخزنة غير موجودة');
  if (fromCashbox.status !== 'active' || toCashbox.status !== 'active') {
    throw new CashboxError('لا يمكن التحويل بين خزن غير نشطة');
  }

  const transferId = `TRF-${crypto.randomUUID()}`;
  const description = params.description || `تحويل من ${fromCashbox.name} إلى ${toCashbox.name}`;

  const outTx = await recordCashboxTransactionInTx(tx, {
    tenantId: params.tenantId,
    cashboxId: params.fromCashboxId,
    type: 'treasury_transfer',
    direction: 'out',
    amount,
    date: params.date,
    referenceType: 'CashboxTransfer',
    referenceId: transferId,
    description,
    createdBy: params.createdBy,
  });

  const inTx = await recordCashboxTransactionInTx(tx, {
    tenantId: params.tenantId,
    cashboxId: params.toCashboxId,
    type: 'treasury_transfer',
    direction: 'in',
    amount,
    date: params.date,
    referenceType: 'CashboxTransfer',
    referenceId: transferId,
    description,
    createdBy: params.createdBy,
  });

  await ensureCashAccountInTx(tx, params.tenantId);
  const entryNumber = await allocateEntityCode(CODE_ENTITY_KEYS.JOURNAL_ENTRY, params.tenantId, tx);
  const journalEntry = await (tx as any).journalEntry.create({
    data: {
      entryNumber,
      entryDate: params.date ?? new Date(),
      description,
      referenceType: 'CashboxTransfer',
      referenceId: transferId,
      totalDebit: amount,
      totalCredit: amount,
      isPosted: true,
      postedDate: new Date(),
      createdBy: params.createdBy,
      tenantId: params.tenantId,
      lines: {
        create: [
          {
            accountCode: '1001',
            debit: amount,
            credit: 0,
            description: `مدين: ${toCashbox.name}`,
            tenantId: params.tenantId,
          },
          {
            accountCode: '1001',
            debit: 0,
            credit: amount,
            description: `دائن: ${fromCashbox.name}`,
            tenantId: params.tenantId,
          },
        ],
      },
    },
    include: { lines: true },
  });

  return { transferId, outTransaction: outTx, inTransaction: inTx, journalEntry };
}

async function ensureCashAccountInTx(tx: Prisma.TransactionClient, tenantId: string) {
  await (tx as any).account.upsert({
    where: { tenantId_code: { tenantId, code: '1001' } },
    update: {},
    create: {
      code: '1001',
      nameAr: 'النقد وما يعادله',
      nameEn: 'Cash & Equivalents',
      type: 'Asset',
      subType: 'Cash',
      isActive: true,
      tenantId,
    },
  });
}
