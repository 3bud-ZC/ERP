import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';
import { parseRange } from '@/lib/analytics/date-range';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type DayPoint = { day: string; value: number };

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const { searchParams } = new URL(request.url);
    const { start, end } = parseRange(searchParams, { defaultDays: 30 });
    const tenantId = user.tenantId;

    const [
      salesAgg,
      purchaseAgg,
      expenseAgg,
      treasuryBalanceAgg,
      inventoryValuationAgg,
      lowStockProducts,
      topSellingRaw,
      topCustomersRaw,
      cashflowTrendRaw,
      salesTrendRaw,
      purchaseTrendRaw,
      inventoryMoveTrendRaw,
      manufacturingCostAgg,
      recentCash,
    ] = await Promise.all([
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
      (prisma as any).cashbox.aggregate({
        where: { tenantId, status: 'active' },
        _sum: { currentBalance: true },
      }),
      prisma.inventoryValuation.aggregate({
        where: { tenantId },
        _sum: { totalValue: true },
      }),
      prisma.product.findMany({
        where: { tenantId, isActive: true, minStock: { gt: 0 } },
        select: { id: true, code: true, nameAr: true, stock: true, minStock: true, type: true },
        orderBy: [{ stock: 'asc' }],
        take: 200,
      }).then((rows) => rows.filter((p) => Number(p.stock || 0) <= Number(p.minStock || 0)).slice(0, 12)),
      prisma.$queryRaw<{ productId: string; quantity: number; total: number }[]>(Prisma.sql`
        select si."productId" as "productId",
               coalesce(sum(si.quantity), 0)::float as "quantity",
               coalesce(sum(si.total), 0)::float as "total"
        from "SalesInvoiceItem" si
        join "SalesInvoice" s on s.id = si."salesInvoiceId"
        where s."tenantId" = ${tenantId}
          and s.date >= ${start}
          and s.date <= ${end}
        group by si."productId"
        order by "total" desc
        limit 10
      `),
      prisma.$queryRaw<{ customerId: string; total: number }[]>(Prisma.sql`
        select s."customerId" as "customerId",
               coalesce(sum(s."grandTotal"), 0)::float as "total"
        from "SalesInvoice" s
        where s."tenantId" = ${tenantId}
          and s.date >= ${start}
          and s.date <= ${end}
        group by s."customerId"
        order by "total" desc
        limit 10
      `),
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
      prisma.$queryRaw<{ day: Date; total: number }[]>(Prisma.sql`
        select date_trunc('day', s.date) as day,
               coalesce(sum(s."grandTotal"), 0)::float as total
        from "SalesInvoice" s
        where s."tenantId" = ${tenantId}
          and s.date >= ${start}
          and s.date <= ${end}
        group by 1
        order by 1 asc
      `),
      prisma.$queryRaw<{ day: Date; total: number }[]>(Prisma.sql`
        select date_trunc('day', p.date) as day,
               coalesce(sum(p."grandTotal"), 0)::float as total
        from "PurchaseInvoice" p
        where p."tenantId" = ${tenantId}
          and p.date >= ${start}
          and p.date <= ${end}
        group by 1
        order by 1 asc
      `),
      prisma.$queryRaw<{ day: Date; qtyIn: number; qtyOut: number }[]>(Prisma.sql`
        select date_trunc('day', it.date) as day,
               coalesce(sum(case when it.quantity > 0 then it.quantity else 0 end), 0)::float as "qtyIn",
               coalesce(sum(case when it.quantity < 0 then abs(it.quantity) else 0 end), 0)::float as "qtyOut"
        from "InventoryTransaction" it
        where it."tenantId" = ${tenantId}
          and it.date >= ${start}
          and it.date <= ${end}
        group by 1
        order by 1 asc
      `),
      prisma.workInProgress.aggregate({
        where: { productionOrder: { tenantId }, updatedAt: { gte: start, lte: end } },
        _sum: { totalCost: true, rawMaterialCost: true, laborCost: true, overheadCost: true },
        _count: { id: true },
      }),
      (prisma as any).cashboxTransaction.findMany({
        where: { tenantId },
        include: { cashbox: { select: { id: true, code: true, name: true } } },
        orderBy: { date: 'desc' },
        take: 10,
      }),
    ]);

    const productsById = await fetchProductsMap(topSellingRaw.map((r) => r.productId), tenantId);
    const customersById = await fetchCustomersMap(topCustomersRaw.map((r) => r.customerId), tenantId);

    const totalSales = Number(salesAgg._sum.grandTotal || 0);
    const totalPurchases = Number(purchaseAgg._sum.grandTotal || 0);
    const totalExpenses = Number(expenseAgg._sum.total || expenseAgg._sum.amount || 0);
    const estimatedNetProfit = totalSales - totalPurchases - totalExpenses;

    const outstandingReceivables = await computeOutstanding(prisma, tenantId, 'sales');
    const outstandingPayables = await computeOutstanding(prisma, tenantId, 'purchase');

    return apiSuccess({
      range: { from: start, to: end },
      kpis: {
        totalSales,
        totalPurchases,
        totalExpenses,
        estimatedNetProfit,
        treasuryBalance: Number(treasuryBalanceAgg?._sum?.currentBalance || 0),
        inventoryValue: Number(inventoryValuationAgg?._sum?.totalValue || 0),
        outstandingReceivables,
        outstandingPayables,
        manufacturingCost: {
          total: Number(manufacturingCostAgg._sum.totalCost || 0),
          raw: Number(manufacturingCostAgg._sum.rawMaterialCost || 0),
          labor: Number(manufacturingCostAgg._sum.laborCost || 0),
          overhead: Number(manufacturingCostAgg._sum.overheadCost || 0),
          orders: manufacturingCostAgg._count.id,
        },
        counts: {
          salesInvoices: salesAgg._count.id,
          purchaseInvoices: purchaseAgg._count.id,
          expenses: expenseAgg._count.id,
        },
      },
      trends: {
        sales: toDayPoints(salesTrendRaw, 'total'),
        purchases: toDayPoints(purchaseTrendRaw, 'total'),
        cashIn: cashflowTrendRaw.map((r) => ({ day: isoDay(r.day), value: Number(r.inflow || 0) } satisfies DayPoint)),
        cashOut: cashflowTrendRaw.map((r) => ({ day: isoDay(r.day), value: Number(r.outflow || 0) } satisfies DayPoint)),
        inventoryIn: inventoryMoveTrendRaw.map((r) => ({ day: isoDay(r.day), value: Number(r.qtyIn || 0) } satisfies DayPoint)),
        inventoryOut: inventoryMoveTrendRaw.map((r) => ({ day: isoDay(r.day), value: Number(r.qtyOut || 0) } satisfies DayPoint)),
        profit: mergeProfitTrend(salesTrendRaw, purchaseTrendRaw, expenseAgg, start, end),
      },
      top: {
        products: topSellingRaw.map((r) => ({
          productId: r.productId,
          code: productsById[r.productId]?.code || '',
          nameAr: productsById[r.productId]?.nameAr || 'منتج',
          quantity: Number(r.quantity || 0),
          total: Number(r.total || 0),
        })),
        customers: topCustomersRaw.map((r) => ({
          customerId: r.customerId,
          code: customersById[r.customerId]?.code || '',
          nameAr: customersById[r.customerId]?.nameAr || 'عميل',
          total: Number(r.total || 0),
        })),
      },
      alerts: {
        lowStock: lowStockProducts,
      },
      recent: {
        cash: recentCash,
      },
    }, 'تم جلب لوحة التنفيذي');
  } catch (error) {
    return handleApiError(error, 'Executive analytics');
  }
}

function isoDay(day: Date) {
  return new Date(day).toISOString().slice(0, 10);
}

function toDayPoints(rows: Array<{ day: Date; total: number }>, field: 'total'): DayPoint[] {
  return rows.map((r) => ({ day: isoDay(r.day), value: Number((r as any)[field] || 0) }));
}

function mergeProfitTrend(
  sales: Array<{ day: Date; total: number }>,
  purchases: Array<{ day: Date; total: number }>,
  expenseAgg: any,
  start: Date,
  end: Date,
): DayPoint[] {
  // Lightweight estimate: sales - purchases - avgDailyExpenses over range
  const dayCount = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
  const totalExpenses = Number(expenseAgg?._sum?.total || expenseAgg?._sum?.amount || 0);
  const avgExpense = totalExpenses / dayCount;
  const salesBy = new Map(sales.map((s) => [isoDay(s.day), Number(s.total || 0)]));
  const purchBy = new Map(purchases.map((p) => [isoDay(p.day), Number(p.total || 0)]));
  const days = Array.from(new Set([
    ...Array.from(salesBy.keys()),
    ...Array.from(purchBy.keys()),
  ])).sort();
  return days.map((d) => ({ day: d, value: (salesBy.get(d) || 0) - (purchBy.get(d) || 0) - avgExpense }));
}

async function computeOutstanding(db: typeof prisma, tenantId: string, kind: 'sales' | 'purchase') {
  const rows = kind === 'sales'
    ? await db.salesInvoice.findMany({
      where: { tenantId, paymentStatus: { in: ['unpaid', 'partial', 'overdue'] } },
      select: { grandTotal: true, total: true, paidAmount: true },
      take: 2000,
    })
    : await db.purchaseInvoice.findMany({
      where: { tenantId, paymentStatus: { in: ['unpaid', 'partial', 'overdue'] } },
      select: { grandTotal: true, total: true, paidAmount: true },
      take: 2000,
    });
  return rows.reduce((sum, r: any) => {
    const due = Number(r.grandTotal || r.total || 0);
    const paid = Number(r.paidAmount || 0);
    return sum + Math.max(0, due - paid);
  }, 0);
}

async function fetchProductsMap(productIds: string[], tenantId: string) {
  const ids = Array.from(new Set(productIds)).filter(Boolean);
  if (!ids.length) return {} as Record<string, { code: string; nameAr: string }>;
  const rows = await prisma.product.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, code: true, nameAr: true },
  });
  return rows.reduce((acc, r) => {
    acc[r.id] = { code: r.code, nameAr: r.nameAr };
    return acc;
  }, {} as Record<string, { code: string; nameAr: string }>);
}

async function fetchCustomersMap(customerIds: string[], tenantId: string) {
  const ids = Array.from(new Set(customerIds)).filter(Boolean);
  if (!ids.length) return {} as Record<string, { code: string; nameAr: string }>;
  const rows = await prisma.customer.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, code: true, nameAr: true },
  });
  return rows.reduce((acc, r) => {
    acc[r.id] = { code: r.code, nameAr: r.nameAr };
    return acc;
  }, {} as Record<string, { code: string; nameAr: string }>);
}
