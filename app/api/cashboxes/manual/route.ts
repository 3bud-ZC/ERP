import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';
import { recordCashboxTransactionInTx } from '@/lib/services/cashbox.service';

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
    const description = String((body as any).description || '').trim() || undefined;
    const dateRaw = (body as any).date ? new Date((body as any).date) : undefined;

    if (!cashboxId) return apiError('يجب اختيار الخزنة', 400);
    if (direction !== 'in' && direction !== 'out') return apiError('نوع الحركة غير صالح', 400);
    if (!Number.isFinite(amount) || amount <= 0) return apiError('المبلغ يجب أن يكون أكبر من صفر', 400);
    if (dateRaw && Number.isNaN(dateRaw.getTime())) return apiError('التاريخ غير صالح', 400);

    const manualRef = `MNL-${crypto.randomUUID()}`;
    const type = direction === 'in' ? 'manual_in' : 'manual_out';

    const txRow = await prisma.$transaction(async (tx) => {
      return recordCashboxTransactionInTx(tx, {
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
    });

    return apiSuccess(txRow, 'تم تسجيل حركة خزنة بنجاح');
  } catch (error) {
    return handleApiError(error, 'Manual cashbox tx');
  }
}

