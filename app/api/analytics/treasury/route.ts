import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';
import { parseRange } from '@/lib/analytics/date-range';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const { searchParams } = new URL(request.url);
    const { start, end } = parseRange(searchParams, { defaultDays: 30 });
    const tenantId = user.tenantId;

    const [cashboxes, trendRaw, biggestExpenses, receivables, payables, commitments] = await Promise.all([
      (prisma as any).cashbox.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.$queryRaw<{ day: Date; inflow: number; outflow: number }[]>(Prisma.sql`
        select date_trunc('day', t.date) as day,
               coalesce(sum(case when t.direction = 'in' then t.amount else 0 end), 0)::float as inflow,
               coalesce(sum(case when t.direction = 'out' then t.amount else 0 end), 0)::float as outflow
        from "CashboxTransaction" t
        where t."tenantId" = ${tenantId}
          and t.date >= ${start}
          and t.date <= ${end}
        group by 1
        order by 1 asc
      `),
      prisma.expense.findMany({
        where: { tenantId, date: { gte: start, lte: end } },
        orderBy: { total: 'desc' },
        select: { id: true, category: true, description: true, total: true, date: true, cashboxId: true },
        take: 10,
      }),
      prisma.salesInvoice.findMany({
        where: { tenantId, paymentStatus: { in: ['unpaid', 'partial', 'overdue'] } },
        select: { id: true, invoiceNumber: true, date: true, paymentTermsDays: true, grandTotal: true, total: true, paidAmount: true, customer: { select: { nameAr: true } } },
        orderBy: { date: 'desc' },
        take: 500,
      }),
      prisma.purchaseInvoice.findMany({
        where: { tenantId, paymentStatus: { in: ['unpaid', 'partial', 'overdue'] } },
        select: { id: true, invoiceNumber: true, date: true, paymentTermsDays: true, grandTotal: true, total: true, paidAmount: true, supplier: { select: { nameAr: true } } },
        orderBy: { date: 'desc' },
        take: 500,
      }),
      (prisma as any).purchaseOrder.findMany({
        where: {
          tenantId,
          cashboxId: { not: null },
          status: { notIn: ['cancelled', 'completed'] },
        },
        select: { id: true, cashboxId: true, total: true, status: true, orderNumber: true, date: true },
        orderBy: { date: 'desc' },
        take: 500,
      }),
    ]);

    const now = new Date();
    const expectedCollections = rollForward(receivables, now, 14);
    const expectedPayments = rollForward(payables, now, 14);

    const treasuryBalance = cashboxes.reduce((s: number, c: { currentBalance: number }) => s + Number(c.currentBalance || 0), 0);
    const commitmentsByCashbox = new Map<string, number>();
    for (const po of commitments ?? []) {
      const cb = String(po.cashboxId || '').trim();
      if (!cb) continue;
      commitmentsByCashbox.set(cb, (commitmentsByCashbox.get(cb) || 0) + Number(po.total || 0));
    }
    const commitmentsTotal = Array.from(commitmentsByCashbox.values()).reduce((s, v) => s + v, 0);

    return apiSuccess({
      range: { from: start, to: end },
      kpis: {
        treasuryBalance,
        purchaseOrderCommitments: commitmentsTotal,
        availableBalance: treasuryBalance - commitmentsTotal,
        dailyInflow: sumLast(trendRaw, 'inflow', 1),
        dailyOutflow: sumLast(trendRaw, 'outflow', 1),
        expectedCollections14d: expectedCollections.total,
        expectedPayments14d: expectedPayments.total,
      },
      trend: trendRaw.map((r) => ({ day: new Date(r.day).toISOString().slice(0, 10), inflow: Number(r.inflow || 0), outflow: Number(r.outflow || 0) })),
      distribution: cashboxes.map((c: any) => ({ id: c.id, code: c.code, name: c.name, balance: Number(c.currentBalance || 0), currency: c.currency, status: c.status })),
      commitments: {
        total: commitmentsTotal,
        byCashbox: cashboxes
          .filter((c: any) => commitmentsByCashbox.has(c.id))
          .map((c: any) => ({ cashboxId: c.id, cashboxName: c.name, cashboxCode: c.code, total: commitmentsByCashbox.get(c.id) || 0 })),
        orders: (commitments ?? []).map((po: any) => ({
          id: po.id,
          orderNumber: po.orderNumber,
          cashboxId: po.cashboxId,
          total: Number(po.total || 0),
          status: po.status,
          date: po.date,
        })),
      },
      biggestExpenses: biggestExpenses.map((e) => ({ ...e, total: Number(e.total || 0), date: e.date })),
      forecast: {
        expectedCollections,
        expectedPayments,
      },
    }, 'تم جلب تحليلات الخزنة');
  } catch (error) {
    return handleApiError(error, 'Treasury analytics');
  }
}

function rollForward(rows: any[], now: Date, days: number) {
  const buckets: Array<{ day: string; value: number; count: number }> = [];
  for (let i = 0; i <= days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    buckets.push({ day: d.toISOString().slice(0, 10), value: 0, count: 0 });
  }
  const startIso = buckets[0].day;
  const endIso = buckets[buckets.length - 1].day;

  for (const inv of rows) {
    const due = new Date(inv.date);
    due.setDate(due.getDate() + Number(inv.paymentTermsDays || 0));
    const iso = due.toISOString().slice(0, 10);
    if (iso < startIso || iso > endIso) continue;
    const total = Number(inv.grandTotal || inv.total || 0);
    const paid = Number(inv.paidAmount || 0);
    const remaining = Math.max(0, total - paid);
    const bucket = buckets.find((b) => b.day === iso);
    if (bucket && remaining > 0.01) {
      bucket.value += remaining;
      bucket.count += 1;
    }
  }

  return { total: buckets.reduce((s, b) => s + b.value, 0), buckets };
}

function sumLast(rows: any[], field: 'inflow' | 'outflow', days: number) {
  if (!rows.length) return 0;
  return rows.slice(-days).reduce((s: number, r: any) => s + Number(r[field] || 0), 0);
}
