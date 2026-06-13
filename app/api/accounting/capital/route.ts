import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { checkPermission, getAuthenticatedUser } from '@/lib/auth';
import { recordCashboxTransactionInTx, reverseCashboxTransactionsInTx } from '@/lib/services/cashbox.service';
import { postJournalLinesInTransaction, type JournalLineDraft } from '@/lib/services/invoice-accounting.service';
import { reverseAllJournalEntriesForReferenceId } from '@/lib/services/journal-reversal.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CAPITAL_REFERENCE_TYPE = 'CapitalContribution';
const CAPITAL_ACCOUNT_CODE = '3010';
const CASH_ACCOUNT_CODE = '1001';
const BANK_ACCOUNT_CODE = '1010';

function parseDate(value: unknown) {
  const date = value ? new Date(String(value)) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error('التاريخ غير صالح');
  return date;
}

function parseAmount(value: unknown) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  return amount;
}

function buildDescription(notes?: string | null) {
  return notes?.trim() ? `تسجيل رأس مال - ${notes.trim()}` : 'تسجيل رأس مال';
}

async function listCapitalContributions(tenantId: string) {
  const entries = await prisma.journalEntry.findMany({
    where: {
      tenantId,
      referenceType: CAPITAL_REFERENCE_TYPE,
      isPosted: true,
    },
    include: {
      lines: true,
    },
    orderBy: { entryDate: 'desc' },
  });

  const referenceIds = entries.map((entry) => entry.referenceId).filter(Boolean) as string[];
  const cashboxTransactions = referenceIds.length
    ? await (prisma as any).cashboxTransaction.findMany({
        where: {
          tenantId,
          referenceType: CAPITAL_REFERENCE_TYPE,
          referenceId: { in: referenceIds },
        },
        include: {
          cashbox: { select: { id: true, code: true, name: true } },
        },
        orderBy: { date: 'desc' },
      })
    : [];

  const cashboxMap = new Map<string, any>();
  for (const tx of cashboxTransactions) {
    if (!cashboxMap.has(tx.referenceId)) cashboxMap.set(tx.referenceId, tx);
  }

  return entries.map((entry) => {
    const debitLine = entry.lines.find((line) => Number(line.debit || 0) > 0);
    const capitalLine = entry.lines.find((line) => line.accountCode === CAPITAL_ACCOUNT_CODE);
    const cashboxTx = entry.referenceId ? cashboxMap.get(entry.referenceId) : null;
    const sourceType = cashboxTx ? 'cashbox' : 'bank';
    return {
      id: entry.referenceId || entry.id,
      journalEntryId: entry.id,
      amount: Number(capitalLine?.credit || entry.totalCredit || 0),
      date: entry.entryDate,
      notes: entry.description || '',
      sourceType,
      sourceAccountCode: debitLine?.accountCode || (sourceType === 'bank' ? BANK_ACCOUNT_CODE : CASH_ACCOUNT_CODE),
      cashbox: cashboxTx?.cashbox || null,
    };
  });
}

async function createCapitalContribution(params: {
  tenantId: string;
  userId: string;
  referenceId?: string;
  amount: number;
  date: Date;
  notes?: string | null;
  sourceType: 'cashbox' | 'bank';
  cashboxId?: string | null;
  bankAccountCode?: string | null;
}) {
  const referenceId = params.referenceId || `CAP-${crypto.randomUUID()}`;
  const sourceAccountCode = params.sourceType === 'bank'
    ? String(params.bankAccountCode || BANK_ACCOUNT_CODE)
    : CASH_ACCOUNT_CODE;

  return prisma.$transaction(async (tx) => {
    if (params.sourceType === 'cashbox') {
      if (!params.cashboxId) throw new Error('يجب اختيار الخزنة');
      await recordCashboxTransactionInTx(tx, {
        tenantId: params.tenantId,
        cashboxId: params.cashboxId,
        type: 'capital_contribution',
        direction: 'in',
        amount: params.amount,
        date: params.date,
        referenceType: CAPITAL_REFERENCE_TYPE,
        referenceId,
        description: buildDescription(params.notes),
        createdBy: params.userId,
      });
    }

    const lines: JournalLineDraft[] = [
      {
        accountCode: sourceAccountCode,
        debit: params.amount,
        credit: 0,
        description: params.sourceType === 'bank' ? 'زيادة البنك من رأس المال' : 'زيادة الخزنة من رأس المال',
        tenantId: params.tenantId,
      },
      {
        accountCode: CAPITAL_ACCOUNT_CODE,
        debit: 0,
        credit: params.amount,
        description: 'إثبات رأس المال',
        tenantId: params.tenantId,
      },
    ];

    const journalEntry = await postJournalLinesInTransaction(tx, {
      tenantId: params.tenantId,
      userId: params.userId,
      entryDate: params.date,
      description: buildDescription(params.notes),
      referenceType: CAPITAL_REFERENCE_TYPE,
      referenceId,
      lines,
      correlationId: `${referenceId}:capital`,
    });

    return { referenceId, journalEntryId: journalEntry.id };
  });
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    if (!checkPermission(user, 'view_accounting')) return apiError('ليس لديك صلاحية', 403);

    const rows = await listCapitalContributions(user.tenantId);
    return apiSuccess(rows, 'تم جلب قيود رأس المال');
  } catch (error) {
    return handleApiError(error, 'List capital contributions');
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    if (!checkPermission(user, 'manage_accounting')) return apiError('ليس لديك صلاحية', 403);

    const body = await request.json().catch(() => ({}));
    const amount = parseAmount(body.amount);
    const date = parseDate(body.date);
    const sourceType = String(body.sourceType || 'bank').trim() === 'cashbox' ? 'cashbox' : 'bank';
    const cashboxId = body.cashboxId ? String(body.cashboxId).trim() : null;
    const bankAccountCode = body.bankAccountCode ? String(body.bankAccountCode).trim() : null;
    const notes = body.notes ? String(body.notes).trim() : null;

    const result = await createCapitalContribution({
      tenantId: user.tenantId,
      userId: user.id,
      amount,
      date,
      sourceType,
      cashboxId,
      bankAccountCode,
      notes,
    });

    return apiSuccess(result, 'تم تسجيل رأس المال');
  } catch (error) {
    return handleApiError(error, 'Create capital contribution');
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    if (!checkPermission(user, 'manage_accounting')) return apiError('ليس لديك صلاحية', 403);

    const body = await request.json().catch(() => ({}));
    const referenceId = String(body.id || '').trim();
    if (!referenceId) return apiError('معرف عملية رأس المال مطلوب', 400);

    const amount = parseAmount(body.amount);
    const date = parseDate(body.date);
    const sourceType = String(body.sourceType || 'bank').trim() === 'cashbox' ? 'cashbox' : 'bank';
    const cashboxId = body.cashboxId ? String(body.cashboxId).trim() : null;
    const bankAccountCode = body.bankAccountCode ? String(body.bankAccountCode).trim() : null;
    const notes = body.notes ? String(body.notes).trim() : null;

    await prisma.$transaction(async (tx) => {
      await reverseCashboxTransactionsInTx(tx, {
        tenantId: user.tenantId!,
        referenceType: CAPITAL_REFERENCE_TYPE,
        referenceId,
        createdBy: user.id,
      });
      await reverseAllJournalEntriesForReferenceId(tx, user.tenantId!, referenceId, CAPITAL_REFERENCE_TYPE);
    });

    const result = await createCapitalContribution({
      tenantId: user.tenantId,
      userId: user.id,
      referenceId,
      amount,
      date,
      sourceType,
      cashboxId,
      bankAccountCode,
      notes,
    });

    return apiSuccess(result, 'تم تعديل رأس المال');
  } catch (error) {
    return handleApiError(error, 'Update capital contribution');
  }
}
