import { prisma } from '@/lib/db';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { getAuthenticatedUser, checkPermission, logAuditAction } from '@/lib/auth';
import { executeCompleteStocktake } from '@/lib/services/stocktake-execution.service';
import { getAvailableStockInTx } from '@/lib/services/warehouse-stock.service';
import { InvoiceExecutionError } from '@/lib/services/invoice-execution.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'read_inventory')) return apiError('ليس لديك صلاحية', 403);

    const { searchParams } = new URL(request.url);
    const warehouseId = searchParams.get('warehouseId');
    const status = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId: user.tenantId };
    if (warehouseId) where.warehouseId = warehouseId;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      prisma.stocktake.findMany({
        where,
        include: {
          warehouse: true,
          items: { include: { product: true } },
        },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      prisma.stocktake.count({ where }),
    ]);

    return apiSuccess({ stocktakes: data, total, page, limit }, 'Stocktakes fetched successfully');
  } catch (error) {
    return handleApiError(error, 'Fetch stocktakes');
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'manage_inventory')) return apiError('ليس لديك صلاحية', 403);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);

    const body = await request.json();
    const { warehouseId, date, notes, items } = body;

    if (!warehouseId || !date || !items || !Array.isArray(items) || items.length === 0) {
      return apiError('Warehouse ID, date, and items are required', 400);
    }

    const warehouse = await prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId: user.tenantId },
    });
    if (!warehouse) return apiError('Warehouse not found', 404);

    const validatedItems: Array<{
      productId: string;
      systemQuantity: number;
      physicalQuantity: number;
      variance: number;
      varianceValue: number;
      reason?: string;
    }> = [];
    let totalVarianceValue = 0;

    const tenantId = user.tenantId;
    await prisma.$transaction(async tx => {
      for (const item of items) {
        const product = await tx.product.findFirst({
          where: { id: item.productId, tenantId },
        });
        if (!product) throw new Error(`Product ${item.productId} not found`);

        const systemQuantity = await getAvailableStockInTx(
          tx,
          tenantId,
          item.productId,
          warehouseId,
        );
        const physicalQuantity = item.physicalQuantity;
        const variance = physicalQuantity - systemQuantity;
        const varianceValue = variance * (product.cost || 0);
        totalVarianceValue += varianceValue;

        validatedItems.push({
          productId: item.productId,
          systemQuantity,
          physicalQuantity,
          variance,
          varianceValue,
          reason: item.reason,
        });
      }
    });

    const lastStocktake = await prisma.stocktake.findFirst({
      where: { tenantId: user.tenantId },
      orderBy: { stocktakeNumber: 'desc' },
    });
    const nextNumber = lastStocktake ? parseInt(lastStocktake.stocktakeNumber.slice(3)) + 1 : 1;
    const stocktakeNumber = `STK-${String(nextNumber).padStart(6, '0')}`;

    const stocktake = await prisma.stocktake.create({
      data: {
        stocktakeNumber,
        warehouseId,
        date: new Date(date),
        status: 'in_progress',
        notes,
        tenantId: user.tenantId,
        items: { create: validatedItems },
      },
      include: {
        warehouse: true,
        items: { include: { product: true } },
      },
    });

    await logAuditAction(
      user.id,
      'CREATE',
      'inventory',
      'Stocktake',
      stocktake.id,
      { stocktakeNumber: stocktake.stocktakeNumber, warehouseId, totalVarianceValue },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined,
    );

    return apiSuccess(stocktake, 'Stocktake created successfully');
  } catch (error) {
    return handleApiError(error, 'Create stocktake');
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'manage_inventory')) return apiError('ليس لديك صلاحية', 403);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);

    const body = await request.json();
    const { id, status, notes } = body;

    if (!id) return apiError('Stocktake ID is required', 400);

    const existingStocktake = await prisma.stocktake.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { items: { include: { product: true } }, warehouse: true },
    });
    if (!existingStocktake) return apiError('Stocktake not found', 404);

    if (status === 'completed' && existingStocktake.status !== 'completed') {
      try {
        const result = await executeCompleteStocktake({
          tenantId: user.tenantId,
          userId: user.id,
          stocktakeId: id,
        });
        if (notes) {
          await prisma.stocktake.update({ where: { id }, data: { notes } });
        }
        await logAuditAction(
          user.id,
          'UPDATE',
          'inventory',
          'Stocktake',
          id,
          { status: 'completed' },
          request.headers.get('x-forwarded-for') || undefined,
          request.headers.get('user-agent') || undefined,
        );
        return apiSuccess(result.stocktake, 'Stocktake completed successfully');
      } catch (error) {
        if (error instanceof InvoiceExecutionError) return apiError(error.message, 400);
        throw error;
      }
    }

    const stocktake = await prisma.stocktake.update({
      where: { id },
      data: {
        status: status || existingStocktake.status,
        notes: notes ?? existingStocktake.notes,
      },
      include: {
        warehouse: true,
        items: { include: { product: true } },
      },
    });

    await logAuditAction(
      user.id,
      'UPDATE',
      'inventory',
      'Stocktake',
      id,
      { body },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined,
    );

    return apiSuccess(stocktake, 'Stocktake updated successfully');
  } catch (error) {
    return handleApiError(error, 'Update stocktake');
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'manage_inventory')) return apiError('ليس لديك صلاحية', 403);

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return apiError('Stocktake ID is required', 400);

    const stocktake = await prisma.stocktake.findFirst({
      where: { id, tenantId: user.tenantId ?? undefined },
    });
    if (!stocktake) return apiError('Stocktake not found', 404);
    if (stocktake.status === 'completed') {
      return apiError('Cannot delete a completed stocktake', 400);
    }

    await prisma.stocktake.delete({ where: { id } });

    await logAuditAction(
      user.id,
      'DELETE',
      'inventory',
      'Stocktake',
      id,
      {},
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined,
    );

    return apiSuccess({ id }, 'Stocktake deleted successfully');
  } catch (error) {
    return handleApiError(error, 'Delete stocktake');
  }
}
