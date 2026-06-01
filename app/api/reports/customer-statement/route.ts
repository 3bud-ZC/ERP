import { prisma } from '@/lib/db';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';
import { hasReportAccess } from '@/lib/reports/report-access';

// Disable caching for real-time data
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET - Customer statement
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!hasReportAccess(user, 'customer-statement')) return apiError('ليس لديك صلاحية لعرض كشف حساب العميل', 403);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');
    const fromDate = searchParams.get('fromDate') ? new Date(searchParams.get('fromDate')!) : new Date(new Date().getFullYear(), 0, 1);
    const toDate = searchParams.get('toDate') ? new Date(searchParams.get('toDate')!) : new Date();

    if (!customerId) {
      return apiError('يجب اختيار عميل', 400);
    }
    const tenantId = user.tenantId;

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId },
    });

    if (!customer) {
      return apiError('العميل غير موجود', 404);
    }

    const salesInvoices = await prisma.salesInvoice.findMany({
      where: {
        tenantId,
        customerId,
        date: { gte: fromDate, lte: toDate },
      },
      include: {
        items: true,
        payments: true,
      },
      orderBy: { date: 'asc' },
    });

    const salesReturns = await prisma.salesReturn.findMany({
      where: {
        tenantId,
        customerId,
        date: { gte: fromDate, lte: toDate },
      },
      orderBy: { date: 'asc' },
    });

    const payments = await prisma.payment.findMany({
      where: {
        tenantId,
        customerId,
        date: { gte: fromDate, lte: toDate },
      },
      orderBy: { date: 'asc' },
    });

    const openingBalance = await prisma.salesInvoice.aggregate({
      where: {
        tenantId,
        customerId,
        date: { lt: fromDate },
      },
      _sum: { grandTotal: true },
    });

    const openingPayments = await prisma.payment.aggregate({
      where: {
        tenantId,
        customerId,
        date: { lt: fromDate },
      },
      _sum: { amount: true },
    });

    const openingBalanceAmount = (Number(openingBalance._sum.grandTotal || 0)) - (Number(openingPayments._sum.amount || 0));

    // Calculate totals
    const totalInvoices = salesInvoices.reduce((sum, inv) => sum + inv.grandTotal, 0);
    const totalReturns = salesReturns.reduce((sum, ret) => sum + ret.total, 0);
    const totalPayments = payments.reduce((sum, pay) => sum + pay.amount, 0);

    const closingBalance = openingBalanceAmount + totalInvoices - totalReturns - totalPayments;

    // Build transaction list
    const transactions: any[] = [];
    let runningBalance = openingBalanceAmount;

    salesInvoices.forEach((invoice) => {
      runningBalance += invoice.grandTotal;
      transactions.push({
        date: invoice.date,
        type: 'invoice',
        reference: invoice.invoiceNumber,
        description: `فاتورة مبيعات ${invoice.invoiceNumber}`,
        debit: invoice.grandTotal,
        credit: 0,
        balance: runningBalance,
      });
    });

    salesReturns.forEach((ret) => {
      runningBalance -= ret.total;
      transactions.push({
        date: ret.date,
        type: 'return',
        reference: ret.returnNumber,
        description: `إشعار دائن ${ret.returnNumber}`,
        debit: 0,
        credit: ret.total,
        balance: runningBalance,
      });
    });

    payments.forEach((payment) => {
      runningBalance -= payment.amount;
      transactions.push({
        date: payment.date,
        type: 'payment',
        reference: payment.id,
        description: 'تحصيل دفعة',
        debit: 0,
        credit: payment.amount,
        balance: runningBalance,
      });
    });

    transactions.sort((a, b) => a.date.getTime() - b.date.getTime());

    return apiSuccess(
      {
        customer: {
          id: customer.id,
          code: customer.code,
          nameAr: customer.nameAr,
          nameEn: customer.nameEn,
          phone: customer.phone,
          email: customer.email,
          address: customer.address,
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
      'تم إنشاء كشف حساب العميل بنجاح'
    );
  } catch (error) {
    return handleApiError(error, 'Customer statement');
  }
}
