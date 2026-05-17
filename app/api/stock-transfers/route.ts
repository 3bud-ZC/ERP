import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { getAuthenticatedUser, checkPermission, logAuditAction } from '@/lib/auth';
import { CODE_ENTITY_KEYS, resolveEntityCode } from '@/lib/code-sequence.service';
import { executeCompleteStockTransfer } from '@/lib/services/stock-transfer-execution.service';
import { getAvailableStock } from '@/lib/services/warehouse-stock.service';
import { InvoiceExecutionError } from '@/lib/services/invoice-execution.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'read_inventory')) return apiError('ليس لديك صلاحية', 403);

    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    const fromWarehouseId = searchParams.get('fromWarehouseId');
    const toWarehouseId = searchParams.get('toWarehouseId');
    const status = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId: user.tenantId };
    if (productId) where.productId = productId;
    if (fromWarehouseId) where.fromWarehouseId = fromWarehouseId;
    if (toWarehouseId) where.toWarehouseId = toWarehouseId;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      prisma.stockTransfer.findMany({
        where,
        include: { product: true, fromWarehouse: true, toWarehouse: true },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      prisma.stockTransfer.count({ where }),
    ]);

    return apiSuccess({ stockTransfers: data, total, page, limit }, 'Stock transfers fetched successfully');
  } catch (error) {
    return handleApiError(error, 'Fetch stock transfers');
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'manage_inventory')) return apiError('ليس لديك صلاحية', 403);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);

    const body = await request.json();
    const { productId, fromWarehouseId, toWarehouseId, quantity, notes, date } = body;

    if (!productId || !fromWarehouseId || !toWarehouseId || !quantity) {
      return apiError('Product ID, from warehouse ID, to warehouse ID, and quantity are required', 400);
    }

    if (fromWarehouseId === toWarehouseId) {
      return apiError('Source and destination warehouses must be different', 400);
    }

    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId: user.tenantId },
    });
    if (!product) return apiError('Product not found', 404);

    const [fromWarehouse, toWarehouse] = await Promise.all([
      prisma.warehouse.findFirst({ where: { id: fromWarehouseId, tenantId: user.tenantId } }),
      prisma.warehouse.findFirst({ where: { id: toWarehouseId, tenantId: user.tenantId } }),
    ]);
    if (!fromWarehouse) return apiError('Source warehouse not found', 404);
    if (!toWarehouse) return apiError('Destination warehouse not found', 404);

    const avail = await getAvailableStock(user.tenantId, productId, fromWarehouseId);
    if (avail < Number(quantity)) {
      return apiError(`Insufficient stock. Available: ${avail}, Required: ${quantity}`, 400);
    }

    const transferNumber = await resolveEntityCode(
      body.transferNumber,
      CODE_ENTITY_KEYS.STOCK_TRANSFER,
      user.tenantId,
    );

    const transfer = await prisma.stockTransfer.create({
      data: {
        transferNumber,
        productId,
        fromWarehouseId,
        toWarehouseId,
        quantity: Number(quantity),
        status: 'pending',
        date: date ? new Date(date) : new Date(),
        notes,
        tenantId: user.tenantId,
      },
      include: { product: true, fromWarehouse: true, toWarehouse: true },
    });

    await logAuditAction(
      user.id,
      'CREATE',
      'inventory',
      'StockTransfer',
      transfer.id,
      { transferNumber: transfer.transferNumber, productId, fromWarehouseId, toWarehouseId, quantity },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined,
    );

    return apiSuccess(transfer, 'Stock transfer created successfully');
  } catch (error) {
    return handleApiError(error, 'Create stock transfer');
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

    if (!id) return apiError('Stock transfer ID is required', 400);

    const existingTransfer = await prisma.stockTransfer.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existingTransfer) return apiError('Stock transfer not found', 404);
    if (existingTransfer.status === 'completed') {
      return apiError('Cannot modify a completed stock transfer', 400);
    }

    if (status === 'completed' && existingTransfer.status !== 'completed') {
      try {
        const completed = await executeCompleteStockTransfer({
          tenantId: user.tenantId,
          userId: user.id,
          transferId: id,
        });
        if (notes) {
          await prisma.stockTransfer.update({ where: { id }, data: { notes } });
        }
        await logAuditAction(
          user.id,
          'UPDATE',
          'inventory',
          'StockTransfer',
          id,
          { status: 'completed' },
          request.headers.get('x-forwarded-for') || undefined,
          request.headers.get('user-agent') || undefined,
        );
        return apiSuccess(completed, 'Stock transfer completed successfully');
      } catch (error) {
        if (error instanceof InvoiceExecutionError) return apiError(error.message, 400);
        throw error;
      }
    }

    const transfer = await prisma.stockTransfer.update({
      where: { id },
      data: {
        status: status || existingTransfer.status,
        notes: notes ?? existingTransfer.notes,
      },
      include: { product: true, fromWarehouse: true, toWarehouse: true },
    });

    await logAuditAction(
      user.id,
      'UPDATE',
      'inventory',
      'StockTransfer',
      id,
      { body },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined,
    );

    return apiSuccess(transfer, 'Stock transfer updated successfully');
  } catch (error) {
    return handleApiError(error, 'Update stock transfer');
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'manage_inventory')) return apiError('ليس لديك صلاحية', 403);

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return apiError('Stock transfer ID is required', 400);

    const transfer = await prisma.stockTransfer.findFirst({
      where: { id, tenantId: user.tenantId ?? undefined },
    });
    if (!transfer) return apiError('Stock transfer not found', 404);
    if (transfer.status === 'completed') {
      return apiError('Cannot delete a completed stock transfer', 400);
    }

    await prisma.stockTransfer.delete({ where: { id } });

    await logAuditAction(
      user.id,
      'DELETE',
      'inventory',
      'StockTransfer',
      id,
      {},
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined,
    );

    return apiSuccess({ id }, 'Stock transfer deleted successfully');
  } catch (error) {
    return handleApiError(error, 'Delete stock transfer');
  }
}
