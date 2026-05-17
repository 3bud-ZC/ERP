import { prisma } from '@/lib/db';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { getAuthenticatedUser, checkPermission, logAuditAction } from '@/lib/auth';
import { CODE_ENTITY_KEYS, resolveEntityCode } from '@/lib/code-sequence.service';
import {
  executeCreateAndApproveStockAdjustment,
  executeApproveStockAdjustment,
} from '@/lib/services/stock-adjustment-execution.service';
import { InvoiceExecutionError } from '@/lib/services/invoice-execution.service';
import { mapExecutionError } from '@/lib/services/invoice-execution.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'read_inventory')) return apiError('ليس لديك صلاحية', 403);

    const { searchParams } = new URL(request.url);
    const where: Record<string, unknown> = { tenantId: user.tenantId };
    if (searchParams.get('productId')) where.productId = searchParams.get('productId');
    if (searchParams.get('status')) where.status = searchParams.get('status');
    if (searchParams.get('type')) where.type = searchParams.get('type');

    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)));

    const [data, total] = await Promise.all([
      prisma.stockAdjustment.findMany({
        where,
        include: { product: true },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.stockAdjustment.count({ where }),
    ]);

    return apiSuccess({ stockAdjustments: data, total, page, limit }, 'Stock adjustments fetched');
  } catch (error) {
    return handleApiError(error, 'Fetch stock adjustments');
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'manage_inventory')) return apiError('ليس لديك صلاحية', 403);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);

    const body = await request.json();
    const { productId, type, quantity, reason, notes, date } = body;

    if (!productId || !type || !quantity || !reason) {
      return apiError('Product ID, type, quantity, and reason are required', 400);
    }
    if (type !== 'increase' && type !== 'decrease') {
      return apiError('Type must be increase or decrease', 400);
    }

    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId: user.tenantId },
    });
    if (!product) return apiError('Product not found', 404);

    const adjustmentNumber = await resolveEntityCode(
      body.adjustmentNumber,
      CODE_ENTITY_KEYS.STOCK_ADJUSTMENT,
      user.tenantId,
    );

    try {
      const adjustment = await executeCreateAndApproveStockAdjustment({
        tenantId: user.tenantId,
        userId: user.id,
        productId,
        type,
        quantity: Number(quantity),
        reason,
        notes,
        date: date ? new Date(date) : undefined,
        adjustmentNumber,
      });

      await logAuditAction(
        user.id,
        'CREATE',
        'inventory',
        'StockAdjustment',
        adjustment.id,
        { adjustment },
        request.headers.get('x-forwarded-for') || undefined,
        request.headers.get('user-agent') || undefined,
      );

      return apiSuccess(adjustment, 'Stock adjustment created successfully');
    } catch (error) {
      if (error instanceof InvoiceExecutionError) {
        const mapped = mapExecutionError(error);
        return apiError(mapped.body.error, mapped.status, mapped.body);
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Create stock adjustment');
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'manage_inventory')) return apiError('ليس لديك صلاحية', 403);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);

    const { id, status, notes } = await request.json();
    if (!id) return apiError('Stock adjustment ID is required', 400);

    const existing = await prisma.stockAdjustment.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) return apiError('Stock adjustment not found', 404);

    if (status === 'approved' && existing.status !== 'approved') {
      try {
        const result = await executeApproveStockAdjustment({
          tenantId: user.tenantId,
          userId: user.id,
          adjustmentId: id,
        });
        return apiSuccess(result.adjustment, 'Stock adjustment approved');
      } catch (error) {
        if (error instanceof InvoiceExecutionError) {
          const mapped = mapExecutionError(error);
          return apiError(mapped.body.error, mapped.status, mapped.body);
        }
        throw error;
      }
    }

    const adjustment = await prisma.stockAdjustment.update({
      where: { id },
      data: { status: status || existing.status, notes: notes ?? existing.notes },
      include: { product: true },
    });

    return apiSuccess(adjustment, 'Stock adjustment updated');
  } catch (error) {
    return handleApiError(error, 'Update stock adjustment');
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'manage_inventory')) return apiError('ليس لديك صلاحية', 403);

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return apiError('Stock adjustment ID is required', 400);

    const adjustment = await prisma.stockAdjustment.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!adjustment) return apiError('Stock adjustment not found', 404);
    if (adjustment.status === 'approved') {
      return apiError('Cannot delete an approved stock adjustment', 400);
    }

    await prisma.stockAdjustment.delete({ where: { id } });
    return apiSuccess({ id }, 'Stock adjustment deleted');
  } catch (error) {
    return handleApiError(error, 'Delete stock adjustment');
  }
}
