import { prisma } from '@/lib/db';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { getAuthenticatedUser, checkPermission, logAuditAction } from '@/lib/auth';
import {
  executeCreateProductionWaste,
  executeDeleteProductionWaste,
} from '@/lib/services/production-waste-execution.service';
import { InvoiceExecutionError } from '@/lib/services/invoice-execution.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'read_inventory')) return apiError('ليس لديك صلاحية', 403);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);

    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    const productionOrderId = searchParams.get('productionOrderId');

    const where: Record<string, unknown> = { tenantId: user.tenantId };
    if (productId) where.productId = productId;
    if (productionOrderId) where.productionOrderId = productionOrderId;

    const wastes = await prisma.productionWaste.findMany({
      where,
      include: {
        product: true,
        productionOrder: { select: { id: true, orderNumber: true } },
      },
      orderBy: { date: 'desc' },
    });

    return apiSuccess(wastes, 'Production waste fetched');
  } catch (error) {
    return handleApiError(error, 'Fetch production waste');
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'manage_inventory')) return apiError('ليس لديك صلاحية', 403);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);

    const body = await request.json();
    const { productId, quantity, date, productionOrderId, notes } = body;

    if (!productId) return apiError('المنتج مطلوب', 400);
    if (!quantity || Number(quantity) <= 0) return apiError('الكمية يجب أن تكون أكبر من صفر', 400);

    try {
      const waste = await executeCreateProductionWaste({
        tenantId: user.tenantId,
        productId,
        quantity: Number(quantity),
        date: date ? new Date(date) : undefined,
        productionOrderId,
        notes,
      });

      await logAuditAction(
        user.id,
        'CREATE',
        'manufacturing',
        'ProductionWaste',
        waste.id,
        { productId, quantity },
        request.headers.get('x-forwarded-for') || undefined,
        request.headers.get('user-agent') || undefined,
      );

      return apiSuccess(waste, 'Production waste recorded');
    } catch (error) {
      if (error instanceof InvoiceExecutionError) return apiError(error.message, 400);
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Create production waste');
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'manage_inventory')) return apiError('ليس لديك صلاحية', 403);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return apiError('id مطلوب', 400);

    try {
      await executeDeleteProductionWaste({ tenantId: user.tenantId, wasteId: id });

      await logAuditAction(
        user.id,
        'DELETE',
        'manufacturing',
        'ProductionWaste',
        id,
        undefined,
        request.headers.get('x-forwarded-for') || undefined,
        request.headers.get('user-agent') || undefined,
      );

      return apiSuccess({ id }, 'Production waste deleted');
    } catch (error) {
      if (error instanceof InvoiceExecutionError) return apiError(error.message, 400);
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Delete production waste');
  }
}
