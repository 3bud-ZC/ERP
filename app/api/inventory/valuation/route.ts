import { prisma } from '@/lib/db';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { getAuthenticatedUser, checkPermission } from '@/lib/auth';
import { createInventoryCostingEngine } from '@/lib/inventory-costing';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET - Inventory valuation from costing layers (InventoryValuation table)
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'view_inventory')) return apiError('ليس لديك صلاحية', 403);

    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    const type = searchParams.get('type');

    const productWhere: Record<string, unknown> = { tenantId: user.tenantId };
    if (productId) productWhere.id = productId;
    if (type === 'raw_material' || type === 'finished_product') productWhere.type = type;

    const products = await prisma.product.findMany({
      where: productWhere,
      select: {
        id: true,
        code: true,
        nameAr: true,
        nameEn: true,
        stock: true,
        type: true,
        cost: true,
      },
    });

    const valuations: Array<{
      productId: string;
      productCode: string;
      productName: string | null;
      productType: string | null;
      quantity: number;
      stockQuantity: number;
      averageCost: number;
      totalValue: number;
      lastUpdated: Date | null;
      isStale: boolean;
    }> = [];

    for (const product of products) {
      let valuation = await prisma.inventoryValuation.findUnique({
        where: { productId: product.id },
      });

      const stockQty = product.stock ?? 0;
      const fallbackValue = stockQty * (product.cost ?? 0);

      if (!valuation && stockQty > 0 && (product.cost ?? 0) > 0) {
        valuations.push({
          productId: product.id,
          productCode: product.code,
          productName: product.nameAr || product.nameEn,
          productType: product.type,
          quantity: stockQty,
          stockQuantity: stockQty,
          averageCost: product.cost ?? 0,
          totalValue: fallbackValue,
          lastUpdated: null,
          isStale: true,
        });
        continue;
      }

      if (!valuation) {
        valuations.push({
          productId: product.id,
          productCode: product.code,
          productName: product.nameAr || product.nameEn,
          productType: product.type,
          quantity: 0,
          stockQuantity: stockQty,
          averageCost: product.cost ?? 0,
          totalValue: 0,
          lastUpdated: null,
          isStale: stockQty > 0,
        });
        continue;
      }

      valuations.push({
        productId: product.id,
        productCode: product.code,
        productName: product.nameAr || product.nameEn,
        productType: product.type,
        quantity: valuation.totalQuantity,
        stockQuantity: stockQty,
        averageCost: valuation.averageCost,
        totalValue: valuation.totalValue,
        lastUpdated: valuation.lastUpdated,
        isStale: Math.abs(valuation.totalQuantity - stockQty) > 0.001,
      });
    }

    const totalInventoryValue = valuations.reduce((sum, v) => sum + v.totalValue, 0);
    const totalQuantity = valuations.reduce((sum, v) => sum + v.quantity, 0);

    return apiSuccess(
      {
        valuations,
        summary: {
          totalInventoryValue,
          totalQuantity,
          productCount: valuations.length,
        },
      },
      'Inventory valuation fetched successfully',
    );
  } catch (error) {
    return handleApiError(error, 'Fetch inventory valuation');
  }
}

// POST - Rebuild FIFO valuation snapshots from layers (does not overwrite layers)
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'manage_inventory')) return apiError('ليس لديك صلاحية', 403);

    const body = await request.json().catch(() => ({}));
    const productId = body?.productId as string | undefined;

    const products = await prisma.product.findMany({
      where: {
        tenantId: user.tenantId!,
        ...(productId ? { id: productId } : {}),
      },
      select: { id: true, code: true },
    });

    const engine = createInventoryCostingEngine(user.tenantId!);
    for (const p of products) {
      await engine.refreshValuation(p.id);
    }

    return apiSuccess({ count: products.length }, 'Valuation refreshed from cost layers');
  } catch (error) {
    return handleApiError(error, 'Recalculate inventory valuation');
  }
}
