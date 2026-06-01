import { prisma } from '@/lib/db';
import { apiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لا يوجد Tenant مرتبط بالمستخدم', 400);

    const tenantId = user.tenantId;

    const [
      tenant,
      customers,
      suppliers,
      products,
      warehouses,
      salesInvoices,
      purchaseInvoices,
      payments,
      cashboxes,
      cashboxTransactions,
      productionOrders,
      journalEntries,
    ] = await prisma.$transaction([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          tenantCode: true,
          name: true,
          nameAr: true,
          status: true,
          subscriptionPlan: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.customer.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
      prisma.supplier.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
      prisma.product.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
      prisma.warehouse.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
      prisma.salesInvoice.findMany({
        where: { tenantId },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.purchaseInvoice.findMany({
        where: { tenantId },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payment.findMany({
        where: { tenantId },
        include: { allocations: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.cashbox.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
      prisma.cashboxTransaction.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
      prisma.productionOrder.findMany({
        where: { tenantId },
        include: { items: true, workInProgress: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.journalEntry.findMany({
        where: { tenantId },
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    if (!tenant) return apiError('بيانات الشركة غير موجودة', 404);

    const payload = {
      meta: {
        exportedAt: new Date().toISOString(),
        exportedBy: { id: user.id, email: user.email, name: user.name },
        tenant,
      },
      data: {
        customers,
        suppliers,
        products,
        warehouses,
        salesInvoices,
        purchaseInvoices,
        payments,
        cashboxes,
        cashboxTransactions,
        productionOrders,
        journalEntries,
      },
    };

    const fileName = `erp-backup-${tenant.tenantCode}-${new Date().toISOString().slice(0, 10)}.json`;
    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return apiError('فشل تصدير البيانات', 500);
  }
}
