import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';
import { hasReportAccess } from '@/lib/reports/report-access';
import { openingNet } from '@/lib/services/party-debt.service';

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
    const [suppliers, invoices, debtRows] = await Promise.all([
      prisma.supplier.findMany({
        where: {
          tenantId: user.tenantId,
          isActive: true,
          ...(supplierId && { id: supplierId }),
        },
        select: {
          id: true,
          code: true,
          nameAr: true,
          openingBalanceType: true,
          openingBalanceAmount: true,
          openingBalanceDate: true,
        },
        orderBy: { nameAr: 'asc' },
      }),
      prisma.purchaseInvoice.findMany({
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
      }),
      prisma.partyDebtTransaction.findMany({
        where: {
          tenantId: user.tenantId,
          partyType: 'supplier',
          transactionType: { in: ['supplier_payment', 'supplier_refund'] },
          ...(supplierId && { supplierId }),
          ...((from || to) && {
            date: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          }),
        },
        select: {
          id: true,
          supplierId: true,
          transactionType: true,
          amount: true,
          date: true,
          notes: true,
        },
        orderBy: { date: 'desc' },
      }),
    ]);

    const now = Date.now();
    const invoiceRows = invoices
      .map(inv => {
        const total = inv.grandTotal || inv.total || 0;
        const paid = inv.paidAmount || 0;
        const remaining = Math.max(0, total - paid);
        const dueDate = new Date(inv.date);
        dueDate.setDate(dueDate.getDate() + (inv.paymentTermsDays || 0));
        const overdueDays = remaining > 0 ? Math.max(0, Math.floor((now - dueDate.getTime()) / 86400000)) : 0;
        return {
          rowId: `invoice-${inv.id}`,
          rowType: 'invoice',
          invoiceId: inv.id,
          statement: 'فاتورة مشتريات',
          reference: inv.invoiceNumber,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.date,
          supplier: inv.supplier,
          total,
          paid,
          remaining,
          dueDate,
          overdueDays,
          paymentStatus: inv.paymentStatus,
        };
      })
      .filter(r => !openOnly || Math.abs(r.remaining) > 0.01)
      .filter(r => (!overdueOnly && paymentStatus !== 'overdue') || r.overdueDays > 0);

    const openingRows = suppliers
      .map((supplier) => {
        const opening = openingNet('supplier', supplier.openingBalanceType, supplier.openingBalanceAmount);
        if (opening <= 0.01) return null;
        const entryDate = supplier.openingBalanceDate || null;
        const overdueDays = entryDate ? Math.max(0, Math.floor((now - new Date(entryDate).getTime()) / 86400000)) : 0;
        return {
          rowId: `opening-${supplier.id}`,
          rowType: 'opening_balance',
          invoiceId: `opening-${supplier.id}`,
          statement: 'رصيد افتتاحي',
          reference: 'رصيد افتتاحي',
          invoiceNumber: 'رصيد افتتاحي',
          invoiceDate: entryDate,
          supplier: { id: supplier.id, code: supplier.code, nameAr: supplier.nameAr },
          total: opening,
          paid: 0,
          remaining: opening,
          dueDate: entryDate,
          overdueDays,
          paymentStatus: 'opening_balance',
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const settlementRows = debtRows.map((row) => {
      const supplier = suppliers.find((item) => item.id === row.supplierId);
      const amount = Number(row.amount || 0);
      const remaining = row.transactionType === 'supplier_payment' ? -amount : amount;
      return {
        rowId: `settlement-${row.id}`,
        rowType: 'settlement',
        invoiceId: `settlement-${row.id}`,
        statement: row.transactionType === 'supplier_payment' ? 'سداد مباشر' : 'تحصيل من المورد',
        reference: row.notes || row.transactionType,
        invoiceNumber: row.notes || row.transactionType,
        invoiceDate: row.date,
        supplier: { id: supplier?.id || '', code: supplier?.code || '-', nameAr: supplier?.nameAr || 'مورد' },
        total: 0,
        paid: amount,
        remaining,
        dueDate: row.date,
        overdueDays: 0,
        paymentStatus: row.transactionType,
      };
    });

    const data = [...openingRows, ...invoiceRows, ...settlementRows]
      .filter((row) => !openOnly || Math.abs(row.remaining) > 0.01)
      .filter((row) => (!overdueOnly && paymentStatus !== 'overdue') || row.overdueDays > 0);

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
