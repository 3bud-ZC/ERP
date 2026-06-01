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
    const { start, end } = parseRange(searchParams, { defaultDays: 60 });
    const tenantId = user.tenantId;

    const [wipAgg, costTrend, wasteTrend, consumptionTrend, expensiveRaw, linePerfRaw] = await Promise.all([
      prisma.workInProgress.aggregate({
        where: { productionOrder: { tenantId }, updatedAt: { gte: start, lte: end } },
        _sum: { totalCost: true, rawMaterialCost: true, laborCost: true, overheadCost: true },
        _count: { id: true },
      }),
      prisma.$queryRaw<{ day: Date; total: number; raw: number; labor: number; overhead: number }[]>(Prisma.sql`
        select date_trunc('day', w."updatedAt") as day,
               coalesce(sum(w."totalCost"), 0)::float as total,
               coalesce(sum(w."rawMaterialCost"), 0)::float as raw,
               coalesce(sum(w."laborCost"), 0)::float as labor,
               coalesce(sum(w."overheadCost"), 0)::float as overhead
        from "WorkInProgress" w
        join "ProductionOrder" po on po.id = w."productionOrderId"
        where po."tenantId" = ${tenantId}
          and w."updatedAt" >= ${start}
          and w."updatedAt" <= ${end}
        group by 1
        order by 1 asc
      `),
      prisma.$queryRaw<{ day: Date; qty: number }[]>(Prisma.sql`
        select date_trunc('day', w.date) as day,
               coalesce(sum(w.quantity), 0)::float as qty
        from "ProductionWaste" w
        where w."tenantId" = ${tenantId}
          and w.date >= ${start}
          and w.date <= ${end}
        group by 1
        order by 1 asc
      `),
      prisma.$queryRaw<{ day: Date; qty: number; cost: number }[]>(Prisma.sql`
        select date_trunc('day', it.date) as day,
               coalesce(sum(abs(it.quantity)), 0)::float as qty,
               coalesce(sum(it."totalCost"), 0)::float as cost
        from "InventoryTransaction" it
        where it."tenantId" = ${tenantId}
          and it.type = 'production_out'
          and it.date >= ${start}
          and it.date <= ${end}
        group by 1
        order by 1 asc
      `),
      prisma.$queryRaw<{ productId: string; totalCost: number; outputQty: number }[]>(Prisma.sql`
        select po."productId" as "productId",
               coalesce(sum(w."totalCost"), 0)::float as "totalCost",
               coalesce(sum(nullif(po."actualOutputQuantity", 0)), 0)::float as "outputQty"
        from "WorkInProgress" w
        join "ProductionOrder" po on po.id = w."productionOrderId"
        where po."tenantId" = ${tenantId}
          and w."updatedAt" >= ${start}
          and w."updatedAt" <= ${end}
        group by po."productId"
        order by "totalCost" desc
        limit 10
      `),
      prisma.$queryRaw<{ lineId: string | null; lineName: string | null; orders: number; avgCostPerUnit: number }[]>(Prisma.sql`
        select po."productionLineId" as "lineId",
               pl.name as "lineName",
               count(*)::int as orders,
               coalesce(avg(case when po."actualOutputQuantity" > 0 then w."totalCost"/po."actualOutputQuantity" else null end), 0)::float as "avgCostPerUnit"
        from "WorkInProgress" w
        join "ProductionOrder" po on po.id = w."productionOrderId"
        left join "ProductionLine" pl on pl.id = po."productionLineId"
        where po."tenantId" = ${tenantId}
          and w."updatedAt" >= ${start}
          and w."updatedAt" <= ${end}
        group by po."productionLineId", pl.name
        order by orders desc
        limit 10
      `),
    ]);

    const prodIds = expensiveRaw.map((r) => r.productId);
    const products = await prisma.product.findMany({
      where: { tenantId, id: { in: prodIds } },
      select: { id: true, code: true, nameAr: true },
    });
    const productMap = products.reduce((acc, p) => {
      acc[p.id] = p;
      return acc;
    }, {} as Record<string, { code: string; nameAr: string }>);

    return apiSuccess({
      range: { from: start, to: end },
      kpis: {
        totalCost: Number(wipAgg._sum.totalCost || 0),
        raw: Number(wipAgg._sum.rawMaterialCost || 0),
        labor: Number(wipAgg._sum.laborCost || 0),
        overhead: Number(wipAgg._sum.overheadCost || 0),
        orders: wipAgg._count.id,
      },
      trends: {
        cost: costTrend.map((r) => ({
          day: new Date(r.day).toISOString().slice(0, 10),
          total: Number(r.total || 0),
          raw: Number(r.raw || 0),
          labor: Number(r.labor || 0),
          overhead: Number(r.overhead || 0),
        })),
        waste: wasteTrend.map((r) => ({ day: new Date(r.day).toISOString().slice(0, 10), qty: Number(r.qty || 0) })),
        consumption: consumptionTrend.map((r) => ({ day: new Date(r.day).toISOString().slice(0, 10), qty: Number(r.qty || 0), cost: Number(r.cost || 0) })),
      },
      mostExpensive: expensiveRaw.map((r) => ({
        productId: r.productId,
        code: productMap[r.productId]?.code || '',
        nameAr: productMap[r.productId]?.nameAr || 'منتج',
        totalCost: Number(r.totalCost || 0),
        outputQty: Number(r.outputQty || 0),
        costPerUnit: Number(r.outputQty || 0) > 0 ? Number(r.totalCost || 0) / Number(r.outputQty || 1) : 0,
      })),
      linePerformance: linePerfRaw.map((r) => ({
        productionLineId: r.lineId,
        name: r.lineName || 'بدون خط',
        orders: Number(r.orders || 0),
        avgCostPerUnit: Number(r.avgCostPerUnit || 0),
      })),
    }, 'تم جلب تحليلات التصنيع');
  } catch (error) {
    return handleApiError(error, 'Manufacturing analytics');
  }
}

