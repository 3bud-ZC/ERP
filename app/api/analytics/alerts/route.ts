import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Alert = {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  href?: string;
  count?: number;
};

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const tenantId = user.tenantId;
    const now = new Date();

    const [lowStock, salesOpen, purchaseOpen, cashboxes] = await Promise.all([
      prisma.product.findMany({
        where: { tenantId, isActive: true, minStock: { gt: 0 } },
        select: { id: true, code: true, nameAr: true, stock: true, minStock: true },
        orderBy: { stock: 'asc' },
        take: 300,
      }).then((rows) => rows.filter((p) => Number(p.stock || 0) <= Number(p.minStock || 0)).slice(0, 15)),
      prisma.salesInvoice.findMany({
        where: { tenantId, paymentStatus: { in: ['unpaid', 'partial', 'overdue'] } },
        select: { id: true, invoiceNumber: true, date: true, paymentTermsDays: true, grandTotal: true, total: true, paidAmount: true },
        take: 600,
        orderBy: { date: 'desc' },
      }),
      prisma.purchaseInvoice.findMany({
        where: { tenantId, paymentStatus: { in: ['unpaid', 'partial', 'overdue'] } },
        select: { id: true, invoiceNumber: true, date: true, paymentTermsDays: true, grandTotal: true, total: true, paidAmount: true },
        take: 600,
        orderBy: { date: 'desc' },
      }),
      (prisma as any).cashbox.findMany({ where: { tenantId, status: 'active' }, select: { id: true, currentBalance: true, name: true } }),
    ]);

    const overdueSales = salesOpen.filter((inv) => isOverdue(inv, now));
    const overduePurchases = purchaseOpen.filter((inv) => isOverdue(inv, now));
    const negativeCashboxes = cashboxes.filter((c: any) => Number(c.currentBalance || 0) < 0);

    const alerts: Alert[] = [];

    if (lowStock.length) {
      alerts.push({
        id: 'low_stock',
        severity: 'warning',
        title: 'تنبيه: مخزون منخفض',
        description: 'يوجد منتجات وصلت للحد الأدنى أو أقل.',
        href: '/inventory/products',
        count: lowStock.length,
      });
    }

    if (overdueSales.length) {
      alerts.push({
        id: 'overdue_receivables',
        severity: 'warning',
        title: 'تنبيه: تحصيلات متأخرة',
        description: 'يوجد فواتير مبيعات متأخرة عن تاريخ الاستحقاق.',
        href: '/reports/receivables?paymentStatus=overdue',
        count: overdueSales.length,
      });
    }

    if (overduePurchases.length) {
      alerts.push({
        id: 'overdue_payables',
        severity: 'warning',
        title: 'تنبيه: مدفوعات متأخرة',
        description: 'يوجد فواتير مشتريات متأخرة عن تاريخ الاستحقاق.',
        href: '/reports/payables?paymentStatus=overdue',
        count: overduePurchases.length,
      });
    }

    if (negativeCashboxes.length) {
      alerts.push({
        id: 'negative_treasury',
        severity: 'critical',
        title: 'خطر: خزنة برصيد سالب',
        description: `يوجد ${negativeCashboxes.length} خزنة/خزن برصيد سالب. راجع الحركات فوراً.`,
        href: '/accounting/treasury/transactions',
        count: negativeCashboxes.length,
      });
    }

    // Tips should always route to the main dashboard overview (no executive dashboard page).
    alerts.push({
      id: 'tips',
      severity: 'info',
      title: 'اقتراحات تشغيلية',
      description: 'راجع لوحة التحكم الرئيسية والخزنة لرؤية الاتجاهات وأكبر المصروفات.',
      href: '/dashboard',
    });

    return apiSuccess({ alerts, lowStock, overdue: { sales: overdueSales.length, purchases: overduePurchases.length } }, 'تم جلب التنبيهات');
  } catch (error) {
    return handleApiError(error, 'Analytics alerts');
  }
}

function isOverdue(inv: any, now: Date) {
  const total = Number(inv.grandTotal || inv.total || 0);
  const paid = Number(inv.paidAmount || 0);
  const remaining = Math.max(0, total - paid);
  if (remaining <= 0.01) return false;
  const due = new Date(inv.date);
  due.setDate(due.getDate() + Number(inv.paymentTermsDays || 0));
  return due.getTime() < now.getTime();
}
