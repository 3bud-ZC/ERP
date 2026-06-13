import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';
import { openingNet } from '@/lib/services/party-debt.service';

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

    const [
      lowStock,
      salesOpen,
      purchaseOpen,
      cashboxes,
      customers,
      customerInvoices,
      customerDebtRows,
      suppliers,
      supplierInvoices,
      supplierDebtRows,
    ] = await Promise.all([
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
      prisma.customer.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, openingBalanceType: true, openingBalanceAmount: true },
      }),
      prisma.salesInvoice.groupBy({
        by: ['customerId'],
        where: { tenantId },
        _sum: { total: true, grandTotal: true, paidAmount: true },
      }),
      prisma.partyDebtTransaction.groupBy({
        by: ['customerId', 'transactionType'],
        where: { tenantId, partyType: 'customer' },
        _sum: { amount: true },
      }),
      prisma.supplier.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, openingBalanceType: true, openingBalanceAmount: true },
      }),
      prisma.purchaseInvoice.groupBy({
        by: ['supplierId'],
        where: { tenantId },
        _sum: { total: true, grandTotal: true, paidAmount: true },
      }),
      prisma.partyDebtTransaction.groupBy({
        by: ['supplierId', 'transactionType'],
        where: { tenantId, partyType: 'supplier' },
        _sum: { amount: true },
      }),
    ]);

    const overdueSales = salesOpen.filter((inv) => isOverdue(inv, now));
    const overduePurchases = purchaseOpen.filter((inv) => isOverdue(inv, now));
    const negativeCashboxes = cashboxes.filter((c: any) => Number(c.currentBalance || 0) < 0);
    const receivableCount = countOpenCustomers(customers as any[], customerInvoices as any[], customerDebtRows as any[]);
    const payableCount = countOpenSuppliers(suppliers as any[], supplierInvoices as any[], supplierDebtRows as any[]);

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

    if (receivableCount > 0) {
      alerts.push({
        id: 'customer_balances_open',
        severity: 'info',
        title: 'متابعة: مديونيات عملاء مفتوحة',
        description: `يوجد ${receivableCount} عميل لديهم رصيد مستحق يحتاج متابعة أو تحصيل.`,
        href: '/reports/receivables?paymentStatus=all',
        count: receivableCount,
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

    if (payableCount > 0) {
      alerts.push({
        id: 'supplier_balances_open',
        severity: 'info',
        title: 'متابعة: مستحقات موردين مفتوحة',
        description: `يوجد ${payableCount} مورد لهم مستحقات قائمة تحتاج سداد أو تسوية.`,
        href: '/reports/payables?paymentStatus=all',
        count: payableCount,
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

function countOpenCustomers(customers: Array<{ id: string; openingBalanceType?: string | null; openingBalanceAmount?: number | null }>, invoices: any[], debtRows: any[]) {
  const invoiceMap = new Map<string, { gross: number; paid: number }>();
  for (const row of invoices) {
    if (!row.customerId) continue;
    invoiceMap.set(row.customerId, {
      gross: Number(row._sum.grandTotal || row._sum.total || 0),
      paid: Number(row._sum.paidAmount || 0),
    });
  }
  const debtMap = new Map<string, number>();
  for (const row of debtRows) {
    if (!row.customerId) continue;
    const current = debtMap.get(row.customerId) || 0;
    const amount = Number(row._sum.amount || 0);
    const delta = row.transactionType === 'customer_collection' ? -amount : row.transactionType === 'customer_refund' ? amount : 0;
    debtMap.set(row.customerId, current + delta);
  }
  return customers.filter((customer) => {
    const invoice = invoiceMap.get(customer.id) || { gross: 0, paid: 0 };
    const opening = openingNet('customer', customer.openingBalanceType, customer.openingBalanceAmount);
    const net = opening + Math.max(0, invoice.gross - invoice.paid) + (debtMap.get(customer.id) || 0);
    return net > 0.01;
  }).length;
}

function countOpenSuppliers(suppliers: Array<{ id: string; openingBalanceType?: string | null; openingBalanceAmount?: number | null }>, invoices: any[], debtRows: any[]) {
  const invoiceMap = new Map<string, { gross: number; paid: number }>();
  for (const row of invoices) {
    if (!row.supplierId) continue;
    invoiceMap.set(row.supplierId, {
      gross: Number(row._sum.grandTotal || row._sum.total || 0),
      paid: Number(row._sum.paidAmount || 0),
    });
  }
  const debtMap = new Map<string, number>();
  for (const row of debtRows) {
    if (!row.supplierId) continue;
    const current = debtMap.get(row.supplierId) || 0;
    const amount = Number(row._sum.amount || 0);
    const delta = row.transactionType === 'supplier_payment' ? -amount : row.transactionType === 'supplier_refund' ? amount : 0;
    debtMap.set(row.supplierId, current + delta);
  }
  return suppliers.filter((supplier) => {
    const invoice = invoiceMap.get(supplier.id) || { gross: 0, paid: 0 };
    const opening = openingNet('supplier', supplier.openingBalanceType, supplier.openingBalanceAmount);
    const net = opening + Math.max(0, invoice.gross - invoice.paid) + (debtMap.get(supplier.id) || 0);
    return net > 0.01;
  }).length;
}
