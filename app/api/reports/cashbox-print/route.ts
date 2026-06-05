import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';
import { hasReportAccess } from '@/lib/reports/report-access';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);
    if (!hasReportAccess(user, 'cashbox-print')) return apiError('ليس لديك صلاحية لعرض تقرير الخزنة', 403);

    const { searchParams } = new URL(request.url);
    const fromRaw = searchParams.get('fromDate');
    const toRaw = searchParams.get('toDate');
    const cashboxId = searchParams.get('cashboxId') || undefined;
    const fromDate = fromRaw ? new Date(fromRaw) : null;
    const toDate = toRaw ? endOfDay(new Date(toRaw)) : endOfDay(new Date());

    const cashboxes = await (prisma as any).cashbox.findMany({
      where: { tenantId: user.tenantId, ...(cashboxId ? { id: cashboxId } : {}) },
      select: { id: true, code: true, name: true, openingBalance: true, currentBalance: true },
      orderBy: { name: 'asc' },
    });
    const cashboxIds = cashboxes.map((c: any) => c.id);

    const [beforeRows, rows] = await Promise.all([
      fromDate
        ? (prisma as any).cashboxTransaction.findMany({
            where: { tenantId: user.tenantId, cashboxId: { in: cashboxIds }, date: { lt: fromDate } },
            select: { direction: true, amount: true },
          })
        : Promise.resolve([]),
      (prisma as any).cashboxTransaction.findMany({
        where: {
          tenantId: user.tenantId,
          cashboxId: { in: cashboxIds },
          date: {
            ...(fromDate ? { gte: fromDate } : {}),
            lte: toDate,
          },
        },
        include: { cashbox: { select: { id: true, code: true, name: true } } },
        orderBy: { date: 'asc' },
      }),
    ]);

    const openingBase = cashboxes.reduce((s: number, c: any) => s + Number(c.openingBalance || 0), 0);
    const beforeDelta = beforeRows.reduce((s: number, r: any) => s + (r.direction === 'in' ? Number(r.amount || 0) : -Number(r.amount || 0)), 0);
    const openingBalance = fromDate ? openingBase + beforeDelta : openingBase;
    const totalIn = rows.filter((r: any) => r.direction === 'in').reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
    const totalOut = rows.filter((r: any) => r.direction === 'out').reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
    const endingBalance = openingBalance + totalIn - totalOut;

    const createdByIds = Array.from(new Set(rows.map((r: any) => r.createdBy).filter(Boolean))) as string[];
    const users = createdByIds.length
      ? await prisma.user.findMany({ where: { id: { in: createdByIds } }, select: { id: true, name: true, email: true } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.name || u.email]));

    return apiSuccess({
      period: { fromDate: fromDate?.toISOString() || null, toDate: toDate.toISOString() },
      cashboxes,
      rows: rows.map((row: any) => ({
        ...row,
        userName: row.createdBy ? userMap.get(row.createdBy) || row.createdBy : null,
      })),
      summary: {
        openingBalance,
        totalIn,
        totalOut,
        endingBalance,
        transactionCount: rows.length,
      },
    }, 'تم جلب تقرير الخزنة');
  } catch (error) {
    return handleApiError(error, 'Cashbox print report');
  }
}

function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
