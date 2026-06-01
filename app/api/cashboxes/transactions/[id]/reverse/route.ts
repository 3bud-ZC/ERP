import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';
import { recordCashboxTransactionInTx } from '@/lib/services/cashbox.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const id = String(params.id || '').trim();
    if (!id) return apiError('معرف الحركة مطلوب', 400);

    const row = await (prisma as any).cashboxTransaction.findFirst({
      where: { id, tenantId: user.tenantId },
      select: {
        id: true,
        cashboxId: true,
        type: true,
        direction: true,
        amount: true,
        referenceType: true,
        referenceId: true,
      },
    });
    if (!row) return apiError('الحركة غير موجودة', 404);

    const isManual = row.type === 'manual_in' || row.type === 'manual_out';
    if (!isManual) return apiError('يمكن عكس الحركات اليدوية فقط من هذه الشاشة', 400);

    const already = await (prisma as any).cashboxTransaction.findFirst({
      where: { tenantId: user.tenantId, referenceType: 'ManualCashboxTxReversal', referenceId: row.id },
      select: { id: true },
    });
    if (already) return apiError('تم عكس هذه الحركة بالفعل', 409);

    const reversal = await prisma.$transaction(async (tx) => {
      return recordCashboxTransactionInTx(tx, {
        tenantId: user.tenantId!,
        cashboxId: row.cashboxId,
        type: `${row.type}_reversal`,
        direction: row.direction === 'in' ? 'out' : 'in',
        amount: Number(row.amount || 0),
        date: new Date(),
        referenceType: 'ManualCashboxTxReversal',
        referenceId: row.id,
        description: 'عكس حركة خزنة (يدوي)',
        createdBy: user.id,
      });
    });

    return apiSuccess({ reversal }, 'تم عكس الحركة بنجاح');
  } catch (error) {
    return handleApiError(error, 'Reverse manual cashbox tx');
  }
}

