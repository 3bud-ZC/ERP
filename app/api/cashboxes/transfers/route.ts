import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser, logAuditAction } from '@/lib/auth';
import { transferBetweenCashboxesInTx } from '@/lib/services/cashbox.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const body = await request.json();
    const amount = Number(body.amount || 0);
    if (!body.fromCashboxId) return apiError('يجب اختيار خزنة المصدر', 400);
    if (!body.toCashboxId) return apiError('يجب اختيار خزنة الوجهة', 400);
    if (!Number.isFinite(amount) || amount <= 0) return apiError('مبلغ التحويل يجب أن يكون أكبر من صفر', 400);

    const result = await prisma.$transaction((tx) => transferBetweenCashboxesInTx(tx, {
      tenantId: user.tenantId!,
      fromCashboxId: body.fromCashboxId,
      toCashboxId: body.toCashboxId,
      amount,
      date: body.date ? new Date(body.date) : new Date(),
      description: body.description || undefined,
      createdBy: user.id,
    }));

    await logAuditAction(
      user.id,
      'CREATE',
      'treasury',
      'CashboxTransfer',
      result.transferId,
      { transfer: result },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined,
    );

    return apiSuccess(result, 'تم تحويل المبلغ بين الخزن بنجاح');
  } catch (error) {
    return handleApiError(error, 'Cashbox transfer');
  }
}

