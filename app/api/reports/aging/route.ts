import { prisma } from '@/lib/db';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';
import { hasReportAccess } from '@/lib/reports/report-access';

// Disable caching for real-time data
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET - Generate Aging Reports (AR/AP)
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!hasReportAccess(user, 'aging')) return apiError('ليس لديك صلاحية لعرض تقرير الأعمار', 403);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'ar';
    const asOfDate = searchParams.get('asOfDate') ? new Date(searchParams.get('asOfDate')!) : new Date();

    if (type !== 'ar' && type !== 'ap') {
      return apiError('نوع التقرير غير صحيح', 400);
    }
    const tenantId = user.tenantId;

    const journalEntries = await prisma.journalEntry.findMany({
      where: {
        tenantId,
        isPosted: true,
        entryDate: { lte: asOfDate },
      },
      include: { lines: true },
    });

    const balances = new Map<string, any>();

    journalEntries.forEach((entry: any) => {
      entry.lines.forEach((line: any) => {
        const accountCode = line.accountCode;
        const debit = Number(line.debit);
        const credit = Number(line.credit);

        const isAR = accountCode === '1021';
        const isAP = accountCode === '2011';

        if ((type === 'ar' && isAR) || (type === 'ap' && isAP)) {
          const netAmount = isAR ? debit - credit : credit - debit;
          const entityId = entry.referenceId;
          if (!entityId) return;

          if (!balances.has(entityId)) {
            balances.set(entityId, {
              entityId,
              balance: 0,
              transactions: [],
            });
          }

          const balanceData = balances.get(entityId);
          balanceData.balance += netAmount;
          balanceData.transactions.push({
            date: entry.entryDate,
            description: entry.description,
            amount: netAmount,
            referenceType: entry.referenceType,
          });
        }
      });
    });

    const agingBuckets = {
      current: 0,
      '1-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    };

    const details: any[] = [];

    const now = asOfDate;
    const oneDay = 24 * 60 * 60 * 1000;

    const entityIds = Array.from(balances.keys());
    const customerMap = new Map<string, { id: string; code: string; nameAr: string | null; nameEn: string | null }>();
    const supplierMap = new Map<string, { id: string; code: string; nameAr: string | null; nameEn: string | null }>();

    if (type === 'ar' && entityIds.length > 0) {
      const customers = await prisma.customer.findMany({
        where: { tenantId, id: { in: entityIds } },
        select: { id: true, code: true, nameAr: true, nameEn: true },
      });
      customers.forEach((c) => customerMap.set(c.id, c));
    }

    if (type === 'ap' && entityIds.length > 0) {
      const suppliers = await prisma.supplier.findMany({
        where: { tenantId, id: { in: entityIds } },
        select: { id: true, code: true, nameAr: true, nameEn: true },
      });
      suppliers.forEach((s) => supplierMap.set(s.id, s));
    }

    const balanceEntries = Array.from(balances.entries());
    for (let i = 0; i < balanceEntries.length; i++) {
      const [entityId, data] = balanceEntries[i];
      if (data.balance <= 0) continue;

      const entity = type === 'ar' ? customerMap.get(entityId) : supplierMap.get(entityId);

      if (!entity) continue;

      const oldestTransaction = data.transactions
        .filter((t: any) => t.amount > 0)
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];

      let daysOverdue = 0;
      let bucket = 'current';
      
      if (oldestTransaction) {
        const transactionDate = new Date(oldestTransaction.date);
        daysOverdue = Math.floor((now.getTime() - transactionDate.getTime()) / oneDay);

        if (daysOverdue > 90) {
          bucket = '90+';
        } else if (daysOverdue > 60) {
          bucket = '61-90';
        } else if (daysOverdue > 30) {
          bucket = '31-60';
        } else if (daysOverdue > 0) {
          bucket = '1-30';
        }
      }

      agingBuckets[bucket as keyof typeof agingBuckets] += data.balance;

      details.push({
        entity,
        balance: data.balance,
        daysOverdue,
        bucket,
        transactionCount: data.transactions.length,
      });
    }

    const totalOutstanding = Object.values(agingBuckets).reduce((sum, val) => sum + val, 0);

    return apiSuccess(
      {
        type: type === 'ar' ? 'الحسابات المدينة' : 'الحسابات الدائنة',
        asOfDate,
        summary: {
          totalOutstanding,
          agingBuckets,
        },
        details: details.sort((a, b) => b.balance - a.balance),
      },
      'تم إنشاء تقرير الأعمار بنجاح'
    );
  } catch (error) {
    return handleApiError(error, 'Aging report');
  }
}
