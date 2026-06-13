import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';
import { recordCashboxTransactionInTx } from '@/lib/services/cashbox.service';
import { MANUAL_CATEGORY_EXPENSE_ACCOUNT, MANUAL_CATEGORY_LABEL } from '@/lib/manual-payment-categories';
import { getPostingProfile } from '@/lib/services/accounting-posting-profile.service';
import { postJournalLinesInTransaction } from '@/lib/services/invoice-accounting.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const body = await request.json().catch(() => ({}));
    const cashboxId = String((body as any).cashboxId || '').trim();
    const direction = String((body as any).direction || '').trim();
    const amount = Number((body as any).amount);
    const category = String((body as any).category || '').trim() || 'other';
    const reason = String((body as any).reason || '').trim();
    const reference = String((body as any).reference || '').trim();
    const description = String((body as any).description || '').trim() || undefined;
    const dateRaw = (body as any).date ? new Date((body as any).date) : undefined;

    if (!cashboxId) return apiError('يجب اختيار الخزنة', 400);
    if (direction !== 'in' && direction !== 'out') return apiError('نوع الحركة غير صالح', 400);
    if (!Number.isFinite(amount) || amount <= 0) return apiError('المبلغ يجب أن يكون أكبر من صفر', 400);
    if (dateRaw && Number.isNaN(dateRaw.getTime())) return apiError('التاريخ غير صالح', 400);

    const manualRef = `MNL-${crypto.randomUUID()}`;
    const type = direction === 'in' ? 'manual_in' : 'manual_out';

    const txRow = await prisma.$transaction(async (tx) => {
      const cashboxTx = await recordCashboxTransactionInTx(tx, {
        tenantId: user.tenantId!,
        cashboxId,
        type,
        direction,
        amount,
        date: dateRaw,
        referenceType: 'ManualCashboxTx',
        referenceId: manualRef,
        description: description || (direction === 'in' ? 'وارد يدوي' : 'منصرف يدوي'),
        createdBy: user.id,
      });

      if (direction === 'out') {
        const categoryLabel = MANUAL_CATEGORY_LABEL[category] || category || 'مصروف يدوي';
        const expense = await (tx as any).expense.create({
          data: {
            expenseNumber: `EXP-MNL-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
            category: categoryLabel,
            description: reason || description || categoryLabel,
            amount,
            tax: 0,
            total: amount,
            date: dateRaw || new Date(),
            notes: reference || null,
            status: 'paid',
            cashboxId,
            tenantId: user.tenantId,
          },
        });

        const profile = await getPostingProfile(user.tenantId!);
        const expenseAccount = MANUAL_CATEGORY_EXPENSE_ACCOUNT[category] || MANUAL_CATEGORY_EXPENSE_ACCOUNT.other;
        await postJournalLinesInTransaction(tx, {
          tenantId: user.tenantId!,
          userId: user.id,
          entryDate: dateRaw || new Date(),
          description: `مصروف يدوي - ${categoryLabel}`,
          referenceType: 'Expense',
          referenceId: expense.id,
          correlationId: `${expense.id}:manual`,
          lines: [
            {
              accountCode: expenseAccount,
              debit: amount,
              credit: 0,
              description: categoryLabel,
              tenantId: user.tenantId!,
            },
            {
              accountCode: profile.cash,
              debit: 0,
              credit: amount,
              description: 'صرف من الخزنة',
              tenantId: user.tenantId!,
            },
          ],
        });
      }

      return cashboxTx;
    });

    return apiSuccess(txRow, 'تم تسجيل حركة خزنة بنجاح');
  } catch (error) {
    return handleApiError(error, 'Manual cashbox tx');
  }
}
