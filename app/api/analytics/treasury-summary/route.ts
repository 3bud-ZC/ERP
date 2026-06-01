import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Lightweight treasury summary for the main treasury hub.
 * Avoids heavy trend/forecast joins to keep the UI snappy.
 */
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين شركة للمستخدم', 400);

    const tenantId = user.tenantId;

    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const [cashboxes, inflow, outflow, commitmentsAgg] = await Promise.all([
      (prisma as any).cashbox.findMany({
        where: { tenantId },
        select: { id: true, code: true, name: true, currency: true, currentBalance: true, status: true },
        orderBy: { createdAt: 'desc' },
      }),
      (prisma as any).cashboxTransaction.aggregate({
        where: { tenantId, direction: 'in', date: { gte: start, lt: end } },
        _sum: { amount: true },
      }),
      (prisma as any).cashboxTransaction.aggregate({
        where: { tenantId, direction: 'out', date: { gte: start, lt: end } },
        _sum: { amount: true },
      }),
      (prisma as any).purchaseOrder.aggregate({
        where: { tenantId, cashboxId: { not: null }, status: { notIn: ['cancelled', 'completed'] } },
        _sum: { total: true },
      }),
    ]);

    const treasuryBalance = (cashboxes ?? []).reduce((s: number, c: any) => s + Number(c.currentBalance || 0), 0);
    const commitmentsTotal = Number(commitmentsAgg?._sum?.total || 0);

    return apiSuccess({
      kpis: {
        treasuryBalance,
        dailyInflow: Number(inflow?._sum?.amount || 0),
        dailyOutflow: Number(outflow?._sum?.amount || 0),
        purchaseOrderCommitments: commitmentsTotal,
        availableBalance: treasuryBalance - commitmentsTotal,
        activeCashboxes: (cashboxes ?? []).filter((c: any) => c.status === 'active').length,
        lowBalanceCount: (cashboxes ?? []).filter((c: any) => Number(c.currentBalance || 0) <= 0).length,
      },
      distribution: (cashboxes ?? []).map((c: any) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        currency: c.currency,
        balance: Number(c.currentBalance || 0),
        status: c.status,
      })),
      range: { day: start.toISOString().slice(0, 10) },
    }, 'تم جلب ملخص الخزنة');
  } catch (error) {
    return handleApiError(error, 'Treasury summary');
  }
}

