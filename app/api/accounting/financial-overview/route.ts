import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const start = from ? new Date(from) : startOfDay(new Date());
    const end = to ? endOfDay(new Date(to)) : endOfDay(new Date());
    const tenantId = user.tenantId;

    const [
      cashboxes,
      cashIn,
      cashOut,
      sales,
      purchases,
      expenses,
      receivables,
      payables,
      overdueSales,
      overduePurchases,
      recentCash,
      recentJournals,
    ] = await Promise.all([
      (prisma as any).cashbox.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
      (prisma as any).cashboxTransaction.aggregate({
        where: { tenantId, direction: 'in', date: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      (prisma as any).cashboxTransaction.aggregate({
        where: { tenantId, direction: 'out', date: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      prisma.salesInvoice.aggregate({
        where: { tenantId, date: { gte: start, lte: end } },
        _sum: { grandTotal: true, paidAmount: true },
        _count: { id: true },
      }),
      prisma.purchaseInvoice.aggregate({
        where: { tenantId, date: { gte: start, lte: end } },
        _sum: { grandTotal: true, paidAmount: true },
        _count: { id: true },
      }),
      prisma.expense.aggregate({
        where: { tenantId, date: { gte: start, lte: end } },
        _sum: { total: true, amount: true },
        _count: { id: true },
      }),
      prisma.salesInvoice.findMany({
        where: { tenantId },
        select: { id: true, invoiceNumber: true, date: true, grandTotal: true, total: true, paidAmount: true, customer: { select: { nameAr: true } } },
        orderBy: { date: 'desc' },
        take: 200,
      }),
      prisma.purchaseInvoice.findMany({
        where: { tenantId },
        select: { id: true, invoiceNumber: true, date: true, grandTotal: true, total: true, paidAmount: true, supplier: { select: { nameAr: true } } },
        orderBy: { date: 'desc' },
        take: 200,
      }),
      prisma.salesInvoice.count({ where: { tenantId, paymentStatus: { in: ['unpaid', 'partial', 'overdue'] } } }),
      prisma.purchaseInvoice.count({ where: { tenantId, paymentStatus: { in: ['unpaid', 'partial', 'overdue'] } } }),
      (prisma as any).cashboxTransaction.findMany({
        where: { tenantId },
        include: { cashbox: { select: { name: true, code: true } } },
        orderBy: { date: 'desc' },
        take: 12,
      }),
      prisma.journalEntry.findMany({
        where: { tenantId },
        include: { lines: { take: 4, include: { account: { select: { nameAr: true } } } } },
        orderBy: { entryDate: 'desc' },
        take: 8,
      }),
    ]);

    const receivableRows = receivables.map((i) => ({
      id: i.id,
      number: i.invoiceNumber,
      party: i.customer?.nameAr || 'عميل',
      total: Number(i.grandTotal || i.total || 0),
      paid: Number(i.paidAmount || 0),
      date: i.date,
    })).filter((i) => i.total - i.paid > 0.01);

    const payableRows = payables.map((i) => ({
      id: i.id,
      number: i.invoiceNumber,
      party: i.supplier?.nameAr || 'مورد',
      total: Number(i.grandTotal || i.total || 0),
      paid: Number(i.paidAmount || 0),
      date: i.date,
    })).filter((i) => i.total - i.paid > 0.01);

    return apiSuccess({
      range: { from: start, to: end },
      summary: {
        treasuryBalance: cashboxes.reduce((sum: number, c: { currentBalance: number }) => sum + Number(c.currentBalance || 0), 0),
        dailyInflow: Number(cashIn._sum.amount || 0),
        dailyOutflow: Number(cashOut._sum.amount || 0),
        revenue: Number(sales._sum.grandTotal || 0),
        purchases: Number(purchases._sum.grandTotal || 0),
        expenses: Number(expenses._sum.total || expenses._sum.amount || 0),
        receivables: receivableRows.reduce((sum, i) => sum + (i.total - i.paid), 0),
        payables: payableRows.reduce((sum, i) => sum + (i.total - i.paid), 0),
        overdueInvoices: overdueSales + overduePurchases,
        salesCount: sales._count.id,
        purchaseCount: purchases._count.id,
        expenseCount: expenses._count.id,
      },
      cashboxes,
      receivables: receivableRows.slice(0, 10),
      payables: payableRows.slice(0, 10),
      recentCash,
      recentJournals,
    }, 'تم جلب لوحة المحاسبة');
  } catch (error) {
    return handleApiError(error, 'Financial overview');
  }
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
