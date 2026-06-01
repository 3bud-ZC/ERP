import { prisma } from '@/lib/db';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';
import { hasReportAccess } from '@/lib/reports/report-access';

// Disable caching for real-time data
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET - Supplier statement
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!hasReportAccess(user, 'supplier-statement')) return apiError('ليس لديك صلاحية لعرض كشف حساب المورد', 403);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const { searchParams } = new URL(request.url);
    const supplierId = searchParams.get('supplierId');
    const fromDate = searchParams.get('fromDate') ? new Date(searchParams.get('fromDate')!) : new Date(new Date().getFullYear(), 0, 1);
    const toDate = searchParams.get('toDate') ? new Date(searchParams.get('toDate')!) : new Date();

    if (!supplierId) {
      return apiError('يجب اختيار مورد', 400);
    }
    const tenantId = user.tenantId;

    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
    });

    if (!supplier) {
      return apiError('المورد غير موجود', 404);
    }

    const purchaseInvoices = await prisma.purchaseInvoice.findMany({
      where: {
        tenantId,
        supplierId,
        date: { gte: fromDate, lte: toDate },
      },
      include: {
        items: true,
        payments: true,
      },
      orderBy: { date: 'asc' },
    });

    const purchaseReturns = await prisma.purchaseReturn.findMany({
      where: {
        tenantId,
        supplierId,
        date: { gte: fromDate, lte: toDate },
      },
      orderBy: { date: 'asc' },
    });

    const payments = await prisma.payment.findMany({
      where: {
        tenantId,
        supplierId,
        date: { gte: fromDate, lte: toDate },
      },
      orderBy: { date: 'asc' },
    });

    const openingBalance = await prisma.purchaseInvoice.aggregate({
      where: {
        tenantId,
        supplierId,
        date: { lt: fromDate },
      },
      _sum: { total: true },
    });

    const openingPayments = await prisma.payment.aggregate({
      where: {
        tenantId,
        supplierId,
        date: { lt: fromDate },
      },
      _sum: { amount: true },
    });

    const openingBalanceAmount = (Number(openingBalance._sum.total || 0)) - (Number(openingPayments._sum.amount || 0));

    // Calculate totals
    const totalInvoices = purchaseInvoices.reduce((sum: number, inv: any) => sum + inv.total, 0);
    const totalReturns = purchaseReturns.reduce((sum: number, ret: any) => sum + ret.total, 0);
    const totalPayments = payments.reduce((sum: number, pay: any) => sum + pay.amount, 0);

    const closingBalance = openingBalanceAmount + totalInvoices - totalReturns - totalPayments;

    const transactions: any[] = [];
    let runningBalance = openingBalanceAmount;

    purchaseInvoices.forEach((invoice: any) => {
      runningBalance += invoice.total;
      transactions.push({
        date: invoice.date,
        type: 'invoice',
        reference: invoice.invoiceNumber,
        description: `فاتورة مشتريات ${invoice.invoiceNumber}`,
        debit: invoice.total,
        credit: 0,
        balance: runningBalance,
      });
    });

    purchaseReturns.forEach((ret: any) => {
      runningBalance -= ret.total;
      transactions.push({
        date: ret.date,
        type: 'return',
        reference: ret.returnNumber,
        description: `إشعار دائن مورد ${ret.returnNumber}`,
        debit: 0,
        credit: ret.total,
        balance: runningBalance,
      });
    });

    payments.forEach((payment: any) => {
      runningBalance -= payment.amount;
      transactions.push({
        date: payment.date,
        type: 'payment',
        reference: payment.id,
        description: 'سداد دفعة',
        debit: 0,
        credit: payment.amount,
        balance: runningBalance,
      });
    });

    transactions.sort((a, b) => a.date.getTime() - b.date.getTime());

    return apiSuccess(
      {
        supplier: {
          id: supplier.id,
          code: supplier.code,
          nameAr: supplier.nameAr,
          nameEn: supplier.nameEn,
          phone: supplier.phone,
          email: supplier.email,
          address: supplier.address,
        },
        period: { from: fromDate, to: toDate },
        openingBalance: openingBalanceAmount,
        transactions,
        summary: {
          totalInvoices,
          totalReturns,
          totalPayments,
          closingBalance,
        },
      },
      'تم إنشاء كشف حساب المورد بنجاح'
    );
  } catch (error) {
    return handleApiError(error, 'Supplier statement');
  }
}
