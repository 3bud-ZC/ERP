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
    if (!hasReportAccess(user, 'receivables')) return apiError('ليس لديك صلاحية لعرض تقرير مديونيات العملاء', 403);

    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId') || undefined;
    const overdueOnly = searchParams.get('overdueOnly') === 'true';
    const paymentStatus = searchParams.get('paymentStatus') || undefined;
    const openOnly = !paymentStatus || paymentStatus === 'open';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;

    const [customers, invoices, debtRows] = await Promise.all([
      prisma.customer.findMany({
        where: {
          tenantId: user.tenantId,
          isActive: true,
          ...(customerId && { id: customerId }),
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
      prisma.salesInvoice.findMany({
        where: {
          tenantId: user.tenantId,
          ...(customerId && { customerId }),
          ...(paymentStatus && !['open', 'overdue'].includes(paymentStatus) && { paymentStatus }),
          ...((from || to) && {
            date: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          }),
        },
        include: { customer: { select: { id: true, code: true, nameAr: true } } },
        orderBy: { date: 'desc' },
      }),
      prisma.partyDebtTransaction.findMany({
        where: {
          tenantId: user.tenantId,
          partyType: 'customer',
          transactionType: { in: ['customer_collection', 'customer_refund'] },
          ...(customerId && { customerId }),
          ...((from || to) && {
            date: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          }),
        },
        select: {
          id: true,
          customerId: true,
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
          statement: 'فاتورة مبيعات',
          reference: inv.invoiceNumber,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.date,
          customer: inv.customer,
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

    const openingRows = customers
      .map((customer) => {
        const opening = openingNet('customer', customer.openingBalanceType, customer.openingBalanceAmount);
        if (opening <= 0.01) return null;
        const entryDate = customer.openingBalanceDate || null;
        const overdueDays = entryDate ? Math.max(0, Math.floor((now - new Date(entryDate).getTime()) / 86400000)) : 0;
        return {
          rowId: `opening-${customer.id}`,
          rowType: 'opening_balance',
          invoiceId: `opening-${customer.id}`,
          statement: 'رصيد افتتاحي',
          reference: 'رصيد افتتاحي',
          invoiceNumber: 'رصيد افتتاحي',
          invoiceDate: entryDate,
          customer: { id: customer.id, code: customer.code, nameAr: customer.nameAr },
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
      const customer = customers.find((item) => item.id === row.customerId);
      const amount = Number(row.amount || 0);
      const remaining = row.transactionType === 'customer_collection' ? -amount : amount;
      return {
        rowId: `settlement-${row.id}`,
        rowType: 'settlement',
        invoiceId: `settlement-${row.id}`,
        statement: row.transactionType === 'customer_collection' ? 'تحصيل مباشر' : 'رصيد دائن للعميل',
        reference: row.notes || row.transactionType,
        invoiceNumber: row.notes || row.transactionType,
        invoiceDate: row.date,
        customer: { id: customer?.id || '', code: customer?.code || '-', nameAr: customer?.nameAr || 'عميل' },
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
    }, 'تم جلب تقرير مديونيات العملاء');
  } catch (error) {
    return handleApiError(error, 'Receivables report');
  }
}
