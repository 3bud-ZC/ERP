import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { validateRawMaterialAvailability, validateProductionStatusTransition } from '@/lib/validation';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { logAuditAction, getAuthenticatedUser, checkPermission } from '@/lib/auth';
import { CODE_ENTITY_KEYS, resolveEntityCode } from '@/lib/code-sequence.service';
import {
  executeCreateProductionOrder,
  executeApproveProductionOrder,
  executeCancelProductionOrder,
  executeCompleteProductionOrder,
  executeDeleteProductionOrder,
  mapProductionError,
  type ProductionMaterialLine,
} from '@/lib/services/production-execution.service';
import { InvoiceExecutionError } from '@/lib/services/invoice-execution.service';
import { recordAuditTrail } from '@/lib/services/audit-trail.service';

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'read_production_order')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const orders = await prisma.productionOrder.findMany({
      where: { tenantId: user.tenantId },
      include: {
        product: true,
        productionLine: true,
        items: { include: { product: true } },
        workInProgress: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return apiSuccess(orders, 'Production orders fetched successfully');
  } catch (error) {
    return handleApiError(error, 'Fetch production orders');
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'create_production_order')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const body = await request.json();
    const {
      productId,
      quantity,
      laborCost = 0,
      overheadCost = 0,
      items: manualItems,
      ...orderData
    } = body as {
      productId: string;
      quantity: number;
      laborCost?: number;
      overheadCost?: number;
      items?: Array<{ materialId: string; quantity: number }>;
      [k: string]: unknown;
    };

    const orderNumber = await resolveEntityCode(
      (orderData as { orderNumber?: string }).orderNumber,
      CODE_ENTITY_KEYS.PRODUCTION_ORDER,
      user.tenantId,
    );

    let perUnitRows: Array<{ materialId: string; quantity: number }>;

    if (Array.isArray(manualItems) && manualItems.length > 0) {
      const cleaned = manualItems
        .map(it => ({
          materialId: String(it.materialId || '').trim(),
          quantity: Number(it.quantity),
        }))
        .filter(it => it.materialId && it.quantity > 0);

      if (cleaned.length === 0) {
        return apiError('يجب اختيار مادة خام واحدة على الأقل بكمية صحيحة', 400);
      }

      const materialIds = Array.from(new Set(cleaned.map(it => it.materialId)));
      const owned = await prisma.product.findMany({
        where: { id: { in: materialIds }, tenantId: user.tenantId },
        select: { id: true },
      });
      if (owned.length !== materialIds.length) {
        return apiError('بعض المواد المختارة غير موجودة', 400);
      }

      const collapsed = new Map<string, number>();
      for (const it of cleaned) {
        collapsed.set(it.materialId, (collapsed.get(it.materialId) ?? 0) + it.quantity);
      }
      perUnitRows = Array.from(collapsed, ([materialId, q]) => ({ materialId, quantity: q }));
    } else {
      const bomItems = await prisma.bOMItem.findMany({
        where: { productId, product: { tenantId: user.tenantId } },
      });
      if (bomItems.length === 0) {
        return apiError('لا يوجد قائمة مواد (BOM) محددة لهذا المنتج', 400);
      }
      perUnitRows = bomItems.map(bom => ({
        materialId: bom.materialId,
        quantity: bom.quantity,
      }));
    }

    const materialLines: ProductionMaterialLine[] = perUnitRows.map(row => ({
      productId: row.materialId,
      quantity: row.quantity * quantity,
    }));

    const validation = await validateRawMaterialAvailability(
      materialLines.map(m => ({ materialId: m.productId, quantity: m.quantity })),
    );
    if (!validation.valid) {
      return apiError('المواد الخام غير كافية للإنتاج', 400, { details: validation.errors });
    }

    try {
      const order = await executeCreateProductionOrder({
        tenantId: user.tenantId,
        userId: user.id,
        orderData: {
          orderNumber,
          productId,
          quantity,
          date: new Date((orderData.date as string) || Date.now()),
          status: (orderData.status as string) || 'pending',
          notes: orderData.notes as string | undefined,
          productionLineId: orderData.productionLineId as string | undefined,
          laborCost: Number(laborCost) || 0,
          overheadCost: Number(overheadCost) || 0,
        },
        materialLines,
      });

      await recordAuditTrail({
        userId: user.id,
        tenantId: user.tenantId,
        module: 'manufacturing',
        entity: 'ProductionOrder',
        entityId: order.id,
        action: 'CREATE',
        after: order,
        ip: request.headers.get('x-forwarded-for') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      });

      return apiSuccess(order, 'Production order created successfully');
    } catch (error) {
      if (error instanceof InvoiceExecutionError) {
        const mapped = mapProductionError(error);
        return apiError(mapped.body.error, mapped.status, mapped.body);
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Create production order');
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'update_production_order')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const body = await request.json();
    const { id, status, actualOutputQuantity, ...updateData } = body;

    const order = await prisma.productionOrder.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { items: true, workInProgress: true },
    });

    if (!order) return apiError('أمر الإنتاج غير موجود', 404);

    if (status && status !== order.status) {
      const { valid, error } = validateProductionStatusTransition(order.status, status);
      if (!valid) return apiError(error || 'Invalid status transition', 400);
    }

    if (status === 'approved' && order.status === 'pending') {
      try {
        const updated = await executeApproveProductionOrder({
          tenantId: user.tenantId,
          userId: user.id,
          productionOrderId: id,
        });
        await recordAuditTrail({
          userId: user.id,
          tenantId: user.tenantId,
          module: 'manufacturing',
          entity: 'ProductionOrder',
          entityId: id,
          action: 'APPROVE',
          before: order,
          after: updated,
          ip: request.headers.get('x-forwarded-for') || undefined,
          userAgent: request.headers.get('user-agent') || undefined,
        });
        return apiSuccess(updated, 'Production order approved');
      } catch (error) {
        if (error instanceof InvoiceExecutionError) {
          const mapped = mapProductionError(error);
          return apiError(mapped.body.error, mapped.status, mapped.body);
        }
        throw error;
      }
    }

    if (status === 'completed' && order.status !== 'completed') {
      const outputQuantity =
        actualOutputQuantity ?? order.plannedQuantity ?? order.quantity;
      try {
        const updated = await executeCompleteProductionOrder({
          tenantId: user.tenantId,
          userId: user.id,
          productionOrderId: id,
          actualOutputQuantity: Number(outputQuantity),
        });
        await recordAuditTrail({
          userId: user.id,
          tenantId: user.tenantId,
          module: 'manufacturing',
          entity: 'ProductionOrder',
          entityId: id,
          action: 'POST',
          before: order,
          after: updated,
          ip: request.headers.get('x-forwarded-for') || undefined,
          userAgent: request.headers.get('user-agent') || undefined,
        });
        return apiSuccess(updated, 'Production order completed successfully');
      } catch (error) {
        if (error instanceof InvoiceExecutionError) {
          const mapped = mapProductionError(error);
          return apiError(mapped.body.error, mapped.status, mapped.body);
        }
        throw error;
      }
    }

    if (status === 'cancelled' && order.status !== 'cancelled') {
      try {
        const updated = await executeCancelProductionOrder({
          tenantId: user.tenantId,
          userId: user.id,
          productionOrderId: id,
        });
        await recordAuditTrail({
          userId: user.id,
          tenantId: user.tenantId,
          module: 'manufacturing',
          entity: 'ProductionOrder',
          entityId: id,
          action: 'CANCEL',
          before: order,
          after: updated,
          ip: request.headers.get('x-forwarded-for') || undefined,
          userAgent: request.headers.get('user-agent') || undefined,
        });
        return apiSuccess(updated, 'Production order cancelled and reversed');
      } catch (error) {
        if (error instanceof InvoiceExecutionError) {
          const mapped = mapProductionError(error);
          return apiError(mapped.body.error, mapped.status, mapped.body);
        }
        throw error;
      }
    }

    const updated = await prisma.productionOrder.update({
      where: { id },
      data: { status, actualOutputQuantity, ...updateData },
      include: { items: true, workInProgress: true, product: true, productionLine: true },
    });

    await recordAuditTrail({
      userId: user.id,
      tenantId: user.tenantId,
      module: 'manufacturing',
      entity: 'ProductionOrder',
      entityId: id,
      action: 'UPDATE',
      before: order,
      after: updated,
      ip: request.headers.get('x-forwarded-for') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return apiSuccess(updated, 'Production order updated successfully');
  } catch (error) {
    return handleApiError(error, 'Update production order');
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'delete_production_order')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return apiError('معرف أمر الإنتاج مطلوب', 400);

    const existing = await prisma.productionOrder.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) return apiError('أمر الإنتاج غير موجود', 404);

    try {
      await executeDeleteProductionOrder({
        tenantId: user.tenantId,
        userId: user.id,
        productionOrderId: id,
      });

      await recordAuditTrail({
        userId: user.id,
        tenantId: user.tenantId,
        module: 'manufacturing',
        entity: 'ProductionOrder',
        entityId: id,
        action: 'DELETE',
        before: existing,
        ip: request.headers.get('x-forwarded-for') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      });

      return apiSuccess({ id }, 'Production order deleted successfully');
    } catch (error) {
      if (error instanceof InvoiceExecutionError) {
        const mapped = mapProductionError(error);
        return apiError(mapped.body.error, mapped.status, mapped.body);
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Delete production order');
  }
}
