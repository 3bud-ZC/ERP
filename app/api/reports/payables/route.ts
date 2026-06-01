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
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    if (!hasReportAccess(user, 'payables')) return apiError('ليس لديك صلاحية لعرض تقرير مستحقات الموردين', 403);

    const { searchParams } = new URL(request.url);
    const supplierId = searchParams.get('supplierId') || undefined;
    const overdueOnly = searchParams.get('overdueOnly') === 'true';
    const paymentStatus = searchParams.get('paymentStatus') || undefined;
    const openOnly = !paymentStatus || paymentStatus === 'open';
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const rows = await prisma.purchaseInvoice.findMany({
      where: {
        tenantId: user.tenantId,
        ...(supplierId && { supplierId }),
        ...(paymentStatus && !['open', 'overdue'].includes(paymentStatus) && { paymentStatus }),
        ...((from || to) && {
          date: {
            ...(from && { gte: new Date(from) }),
            ...(to && { lte: new Date(to) }),
          },
        }),
      },
      include: { supplier: { select: { id: true, code: true, nameAr: true } } },
      orderBy: { date: 'desc' },
    });

    const now = Date.now();
    const data = rows
      .map(inv => {
        const total = inv.grandTotal || inv.total || 0;
        const paid = inv.paidAmount || 0;
        const remaining = Math.max(0, total - paid);
        const dueDate = new Date(inv.date);
        dueDate.setDate(dueDate.getDate() + (inv.paymentTermsDays || 0));
        const overdueDays = remaining > 0 ? Math.max(0, Math.floor((now - dueDate.getTime()) / 86400000)) : 0;
        return { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, invoiceDate: inv.date, supplier: inv.supplier, total, paid, remaining, dueDate, overdueDays, paymentStatus: inv.paymentStatus };
      })
      .filter(r => !openOnly || r.remaining > 0.01)
      .filter(r => (!overdueOnly && paymentStatus !== 'overdue') || r.overdueDays > 0);

    return apiSuccess({
      rows: data,
      summary: {
        invoiceCount: data.length,
        totalInvoices: data.reduce((s, r) => s + r.total, 0),
        totalPaid: data.reduce((s, r) => s + r.paid, 0),
        totalRemaining: data.reduce((s, r) => s + r.remaining, 0),
        overdueCount: data.filter(r => r.overdueDays > 0).length,
      },
    }, 'تم جلب تقرير مستحقات الموردين');
  } catch (error) {
    return handleApiError(error, 'Payables report');
  }
}
