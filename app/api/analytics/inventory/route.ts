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
    const { start, end } = parseRange(searchParams, { defaultDays: 90 });
    const tenantId = user.tenantId;

    const warehouseId = searchParams.get('warehouseId') || undefined;

    const [valuationAgg, productCount, lowStockRows, fastRaw, slowRaw, deadRaw] = await Promise.all([
      prisma.inventoryValuation.aggregate({ where: { tenantId }, _sum: { totalValue: true, totalQuantity: true } }),
      prisma.product.count({ where: { tenantId, isActive: true } }),
      prisma.product.findMany({
        where: { tenantId, isActive: true, minStock: { gt: 0 } },
        select: { id: true, code: true, nameAr: true, stock: true, minStock: true, type: true },
        orderBy: [{ stock: 'asc' }],
        take: 250,
      }).then((rows) => rows.filter((p) => Number(p.stock || 0) <= Number(p.minStock || 0)).slice(0, 25)),
      prisma.$queryRaw<{ productId: string; qtyOut: number; costOut: number }[]>(Prisma.sql`
        select it."productId" as "productId",
               coalesce(sum(abs(it.quantity)), 0)::float as "qtyOut",
               coalesce(sum(it."totalCost"), 0)::float as "costOut"
        from "InventoryTransaction" it
        where it."tenantId" = ${tenantId}
          and it.date >= ${start}
          and it.date <= ${end}
          and it.quantity < 0
          and it.type in ('sale', 'production_out')
          ${warehouseId ? Prisma.sql`and it."warehouseId" = ${warehouseId}` : Prisma.empty}
        group by it."productId"
        order by "qtyOut" desc
        limit 12
      `),
      prisma.$queryRaw<{ productId: string; qtyOut: number; costOut: number }[]>(Prisma.sql`
        select it."productId" as "productId",
               coalesce(sum(abs(it.quantity)), 0)::float as "qtyOut",
               coalesce(sum(it."totalCost"), 0)::float as "costOut"
        from "InventoryTransaction" it
        where it."tenantId" = ${tenantId}
          and it.date >= ${start}
          and it.date <= ${end}
          and it.quantity < 0
          and it.type in ('sale', 'production_out')
          ${warehouseId ? Prisma.sql`and it."warehouseId" = ${warehouseId}` : Prisma.empty}
        group by it."productId"
        having coalesce(sum(abs(it.quantity)), 0) > 0
        order by "qtyOut" asc
        limit 12
      `),
      prisma.$queryRaw<{ productId: string; lastMove: Date | null }[]>(Prisma.sql`
        select p.id as "productId",
               max(it.date) as "lastMove"
        from "Product" p
        left join "InventoryTransaction" it
          on it."productId" = p.id
          and it."tenantId" = ${tenantId}
        where p."tenantId" = ${tenantId}
          and p."isActive" = true
        group by p.id
        having max(it.date) is null or max(it.date) < ${start}
        order by max(it.date) asc nulls first
        limit 20
      `),
    ]);

    const prodIds = [
      ...fastRaw.map((r) => r.productId),
      ...slowRaw.map((r) => r.productId),
      ...deadRaw.map((r) => r.productId),
      ...lowStockRows.map((r) => r.id),
    ];
    const products = await prisma.product.findMany({
      where: { tenantId, id: { in: Array.from(new Set(prodIds)) } },
      select: { id: true, code: true, nameAr: true, stock: true, minStock: true, type: true },
    });
    const productMap = products.reduce((acc, p) => {
      acc[p.id] = p;
      return acc;
    }, {} as Record<string, (typeof products)[number]>);

    const totalValue = Number(valuationAgg._sum.totalValue || 0);
    const totalOutCost = slowRaw.reduce((s, r) => s + Number(r.costOut || 0), 0) + fastRaw.reduce((s, r) => s + Number(r.costOut || 0), 0);
    const turnover = totalValue > 0 ? totalOutCost / totalValue : 0;

    const reorder = lowStockRows.map((p) => {
      const stock = Number(p.stock || 0);
      const min = Number(p.minStock || 0);
      const suggested = Math.max(0, min * 2 - stock);
      return { ...p, suggestedReorderQty: suggested };
    });

    return apiSuccess({
      range: { from: start, to: end },
      kpis: {
        products: productCount,
        inventoryValue: totalValue,
        lowStockCount: lowStockRows.length,
        deadStockCount: deadRaw.length,
        estimatedTurnover: turnover,
      },
      fastMoving: fastRaw.map((r) => ({
        productId: r.productId,
        code: productMap[r.productId]?.code || '',
        nameAr: productMap[r.productId]?.nameAr || 'منتج',
        qtyOut: Number(r.qtyOut || 0),
        costOut: Number(r.costOut || 0),
      })),
      slowMoving: slowRaw.map((r) => ({
        productId: r.productId,
        code: productMap[r.productId]?.code || '',
        nameAr: productMap[r.productId]?.nameAr || 'منتج',
        qtyOut: Number(r.qtyOut || 0),
        costOut: Number(r.costOut || 0),
      })),
      deadStock: deadRaw.map((r) => ({
        productId: r.productId,
        code: productMap[r.productId]?.code || '',
        nameAr: productMap[r.productId]?.nameAr || 'منتج',
        lastMove: r.lastMove ? new Date(r.lastMove).toISOString() : null,
      })),
      reorderSuggestions: reorder,
    }, 'تم جلب تحليلات المخزون');
  } catch (error) {
    return handleApiError(error, 'Inventory analytics');
  }
}

