import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Disable caching for real-time data
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { apiSuccess, apiError, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser, checkPermission, logAuditAction } from '@/lib/auth';
import { workflowEngine, transitionEntity } from '@/lib/workflow-engine';
import { registerAllEventHandlers } from '@/lib/event-handlers';

// Register event handlers on module load
registerAllEventHandlers();

/**
 * Purchase Orders API
 * ERP Workflow Engine Integration
 * - Uses workflow state machine for all state transitions
 * - Events trigger journal entries and stock reservations
 * - DR: Unbilled Inventory (1030) on confirmation
 * - CR: Accrued Payables (2011) on confirmation
 * - Stock inflow reservation on confirmation (NOT actual stock until receipt)
 */

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }
    if (!user.tenantId) {
      return apiError('لم يتم تعيين شركة للمستخدم', 400);
    }

    if (!checkPermission(user, 'read_purchase_invoice')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const orders = await (prisma as any).purchaseOrder.findMany({
      where: { tenantId: user.tenantId },
      include: {
        supplier: true,
        cashbox: { select: { id: true, code: true, name: true } },
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return apiSuccess(orders, 'تم تحميل أوامر الشراء');
  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    return handleApiError(error, 'Fetch purchase orders');
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }
    if (!user.tenantId) {
      return apiError('لم يتم تعيين شركة للمستخدم', 400);
    }

    if (!checkPermission(user, 'create_purchase_invoice')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const body = await request.json();
    const { items, supplierId, orderNumber, date, status, notes, total, cashboxId } = body;

    // Validate required fields
    if (!supplierId) {
      return apiError('يجب اختيار المورد', 400);
    }

    if (!items || items.length === 0) {
      return apiError('يجب إضافة صنف واحد على الأقل', 400);
    }

    if (!date) {
      return apiError('يجب تحديد التاريخ', 400);
    }

    // Verify supplier exists (same tenant)
    const supplier = await (prisma as any).supplier.findFirst({
      where: { id: supplierId, tenantId: user.tenantId },
    });

    if (!supplier) {
      return apiError('المورد غير موجود', 404);
    }

    // Optional treasury commitment cashbox (does not deduct balance).
    let cashboxConnect: { connect: { id: string } } | undefined = undefined;
    if (cashboxId) {
      const cb = await (prisma as any).cashbox.findFirst({
        where: { id: String(cashboxId), tenantId: user.tenantId },
        select: { id: true },
      });
      if (!cb) return apiError('الخزنة المحددة غير موجودة', 404);
      cashboxConnect = { connect: { id: cb.id } };
    }

    // Check for duplicate order number
    if (orderNumber) {
      const existing = await (prisma as any).purchaseOrder.findUnique({
        where: { orderNumber },
      });
      if (existing) {
        return apiError(`رقم أمر الشراء مستخدم بالفعل: ${orderNumber}`, 400);
      }
    }

    // Calculate total if not provided
    const calculatedTotal = total || items.reduce((sum: number, item: any) => {
      const quantity = item.quantity || 0;
      const price = item.unitPrice || item.price || 0;
      return sum + (quantity * price);
    }, 0);

    // Create order with items in transaction
    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await (tx as any).purchaseOrder.create({
        data: {
          orderNumber,
          date: new Date(date),
          status: status || 'pending',
          notes: notes || null,
          total: calculatedTotal,
          tenant: { connect: { id: user.tenantId } },
          supplier: {
            connect: { id: supplierId }
          },
          ...(cashboxConnect ? { cashbox: cashboxConnect } : {}),
          items: {
            create: items.map((item: any) => {
              const quantity = item.quantity || 0;
              const price = item.unitPrice || item.price || 0;
              const total = quantity * price;
              return {
                productId: item.productId,
                quantity,
                price,
                total,
              };
            }),
          },
        },
        include: {
          supplier: true,
          cashbox: { select: { id: true, code: true, name: true } },
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      return newOrder;
    });

    // Trigger workflow transition if status is 'confirmed'
    if (status === 'confirmed') {
      await transitionEntity('PurchaseOrder', order.id, 'ordered', user.id, { calculatedTotal });
    }

    await logAuditAction(
      user.id, 'CREATE', 'purchases', 'PurchaseOrder', order.id, { order },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    );

    return apiSuccess(order, 'تم إنشاء أمر الشراء بنجاح');
  } catch (error: any) {
    console.error('Error creating purchase order:', error);
    return handleApiError(error, 'Create purchase order');
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }
    if (!user.tenantId) {
      return apiError('لم يتم تعيين شركة للمستخدم', 400);
    }

    if (!checkPermission(user, 'update_purchase_invoice')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const body = await request.json();
    const { id, items, orderNumber, date, status, notes, total, supplierId, cashboxId } = body;

    if (!id) {
      return apiError('معرف أمر الشراء مطلوب', 400);
    }

    if (!date) {
      return apiError('يجب تحديد التاريخ', 400);
    }

    // Verify order exists
    const existingOrder = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existingOrder) {
      return apiError('أمر الشراء غير موجود', 404);
    }
    if (existingOrder.tenantId !== user.tenantId) {
      return apiError('ليس لديك صلاحية للوصول لهذا الأمر', 403);
    }

    // Check for duplicate order number (if changed)
    if (orderNumber && orderNumber !== existingOrder.orderNumber) {
      const existing = await (prisma as any).purchaseOrder.findUnique({
        where: { orderNumber },
      });
      if (existing) {
        return apiError(`رقم أمر الشراء مستخدم بالفعل: ${orderNumber}`, 400);
      }
    }

    // Calculate total if items are provided
    const calculatedTotal = items ? items.reduce((sum: number, item: any) => {
      const quantity = item.quantity || 0;
      const price = item.unitPrice || item.price || 0;
      return sum + (quantity * price);
    }, 0) : (total || existingOrder.total);

    // Validate optional supplier switch (same tenant)
    if (supplierId && supplierId !== existingOrder.supplierId) {
      const sup = await (prisma as any).supplier.findFirst({
        where: { id: supplierId, tenantId: user.tenantId },
        select: { id: true },
      });
      if (!sup) return apiError('المورد غير موجود', 404);
    }

    // Optional treasury commitment cashbox update
    let cashboxPatch: any = undefined;
    if (cashboxId !== undefined) {
      const raw = String(cashboxId || '').trim();
      if (!raw) {
        cashboxPatch = { cashbox: { disconnect: true } };
      } else {
        const cb = await (prisma as any).cashbox.findFirst({
          where: { id: raw, tenantId: user.tenantId },
          select: { id: true },
        });
        if (!cb) return apiError('الخزنة المحددة غير موجودة', 404);
        cashboxPatch = { cashbox: { connect: { id: cb.id } } };
      }
    }

    // Update order with workflow transition handling
    const order = await prisma.$transaction(async (tx) => {
      // Update order
      const updatedOrder = await (tx as any).purchaseOrder.update({
        where: { id },
        data: {
          orderNumber,
          date: new Date(date),
          status: status || 'pending',
          notes: notes || null,
          total: calculatedTotal,
          ...(cashboxPatch || {}),
          ...(supplierId && {
            supplier: {
              connect: { id: supplierId }
            }
          }),
          ...(items && {
            items: {
              deleteMany: {},
              create: items.map((item: any) => {
                const quantity = item.quantity || 0;
                const price = item.unitPrice || item.price || 0;
                const total = quantity * price;
                return {
                  productId: item.productId,
                  quantity,
                  price,
                  total,
                };
              }),
            },
          }),
        },
        include: {
          supplier: true,
          cashbox: { select: { id: true, code: true, name: true } },
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      return updatedOrder;
    });

    // Trigger workflow transition if status changed
    if (status && status !== existingOrder.status) {
      await transitionEntity('PurchaseOrder', order.id, status, user.id, { calculatedTotal });
    }

    await logAuditAction(
      user.id, 'UPDATE', 'purchases', 'PurchaseOrder', order.id, { order },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    );

    return apiSuccess(order, 'تم تحديث أمر الشراء بنجاح');
  } catch (error: any) {
    console.error('Error updating purchase order:', error);
    return handleApiError(error, 'Update purchase order');
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }
    if (!user.tenantId) {
      return apiError('لم يتم تعيين شركة للمستخدم', 400);
    }

    if (!checkPermission(user, 'delete_purchase_invoice')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return apiError('معرف أمر الشراء مطلوب', 400);
    }

    // Check if order exists
    const existingOrder = await prisma.purchaseOrder.findUnique({
      where: { id },
    });

    if (!existingOrder) {
      return apiError('أمر الشراء غير موجود', 404);
    }
    if (existingOrder.tenantId !== user.tenantId) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    // Trigger workflow transition to cancelled before deletion
    await transitionEntity('PurchaseOrder', id, 'cancelled', user.id);

    await (prisma as any).$transaction([
      (prisma as any).purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } }),
      (prisma as any).purchaseOrder.delete({ where: { id } }),
    ]);

    await logAuditAction(
      user.id, 'DELETE', 'purchases', 'PurchaseOrder', id, undefined,
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    );

    return apiSuccess({ id }, 'تم حذف أمر الشراء بنجاح');
  } catch (error) {
    console.error('Error deleting purchase order:', error);
    return handleApiError(error, 'Delete purchase order');
  }
}
