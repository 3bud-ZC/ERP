import { productRepo } from '@/lib/repositories/product.repo';

// Disable caching
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { logAuditAction, getAuthenticatedUser, checkPermission } from '@/lib/auth';
import { validateProductType } from '@/lib/validation';
import { productCodeEntityKey, allocateEntityCode } from '@/lib/code-sequence.service';
import { logActivity } from '@/lib/activity-log';

// GET - Read products (finished products only)
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }

    if (!user.tenantId) {
      return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    }

    const { searchParams } = new URL(request.url);
    const typeParam = searchParams.get('type') || undefined;
    const products = await productRepo.listByTenant(user.tenantId, { type: typeParam });
    return apiSuccess(products, 'Products fetched successfully');
  } catch (error) {
    return handleApiError(error, 'Fetch products');
  }
}

// POST - Create product (requires create_product permission)
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }

    if (!checkPermission(user, 'create_product')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const body = await request.json();

    // Validate required fields and field types
    const { code: _ignoredCode, nameAr, nameEn, type, unitId, price, cost, stock, minStock, warehouseId, itemGroupId, companyId } = body;
    if (!nameAr || typeof nameAr !== 'string' || !nameAr.trim()) {
      return apiError('اسم المنتج بالعربية مطلوب', 400);
    }
    if (type && !validateProductType(type)) {
      return apiError('نوع المنتج يجب أن يكون raw_material أو finished_product', 400);
    }
    if (price !== undefined && (typeof price !== 'number' || price < 0)) {
      return apiError('السعر يجب أن يكون رقماً موجباً أو صفراً', 400);
    }
    if (cost !== undefined && (typeof cost !== 'number' || cost < 0)) {
      return apiError('التكلفة يجب أن تكون رقماً موجباً أو صفراً', 400);
    }
    if (stock !== undefined && (typeof stock !== 'number' || stock < 0)) {
      return apiError('المخزون يجب أن يكون رقماً موجباً أو صفراً', 400);
    }
    if (minStock !== undefined && (typeof minStock !== 'number' || minStock < 0)) {
      return apiError('الحد الأدنى للمخزون يجب أن يكون رقماً موجباً أو صفراً', 400);
    }

    // Check tenantId exists
    if (!user.tenantId) {
      return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    }

    const tenant = await (await import('@/lib/db')).prisma.tenant.findUnique({
      where: { id: user.tenantId },
      include: { _count: { select: { products: true } } },
    });
    if (!tenant || tenant.status !== 'active') {
      return apiError('حساب الشركة غير نشط', 403);
    }
    if (tenant._count.products >= tenant.maxProducts) {
      return apiError(`تم الوصول للحد الأقصى للمنتجات في خطة العميل (${tenant.maxProducts})`, 409);
    }

    const productType =
      type && typeof type === 'string' && validateProductType(type)
        ? String(type)
        : 'finished_product';
    const resolvedCode = await allocateEntityCode(
      productCodeEntityKey(productType),
      user.tenantId,
    );

    const { prisma } = await import('@/lib/db');
    if (warehouseId) {
      const warehouse = await prisma.warehouse.findFirst({
        where: { id: String(warehouseId), tenantId: user.tenantId, isActive: true },
        select: { id: true },
      });
      if (!warehouse) return apiError('المخزن غير موجود أو لا يتبع هذا العميل', 400);
    }

    // Whitelist allowed fields — prevent injection of unexpected Prisma fields
    const productData: any = {
      code: resolvedCode,
      nameAr: nameAr.trim(),
      unit: body.unit?.toString()?.trim() || 'piece', // Required field with default
      tenantId: user.tenantId, // Direct tenantId assignment
      ...(nameEn && { nameEn: String(nameEn).trim() }),
      type: productType,
      ...(price !== undefined && { price: Number(price) }),
      ...(cost !== undefined && { cost: Number(cost) }),
      ...(stock !== undefined && { stock: Number(stock) }),
      ...(minStock !== undefined && { minStock: Number(minStock) }),
      ...(unitId && { unitId: String(unitId) }),
      ...(warehouseId && { warehouseId: String(warehouseId) }),
      ...(itemGroupId && { itemGroupId: String(itemGroupId) }),
      ...(companyId && { companyId: String(companyId) }),
    };

    const product = await productRepo.create(productData);

    const openingStock = Number(stock) || 0;
    const openingCost = Number(cost) ?? 0;
    if (openingStock > 0 && warehouseId && user.tenantId) {
      const { upsertWarehouseStockDelta } = await import('@/lib/services/warehouse-stock.service');
      await prisma.$transaction(tx =>
        upsertWarehouseStockDelta(tx, user.tenantId!, product.id, String(warehouseId), openingStock),
      );
    }
    if (openingStock > 0 && user.tenantId) {
      const { recordStockInflow } = await import('@/lib/inventory-costing');
      await recordStockInflow(
        product.id,
        openingStock,
        openingCost,
        user.tenantId,
        'OpeningBalance',
        product.id,
      );
    }

    // Log audit action
    await logAuditAction(
      user.id,
      'CREATE',
      'inventory',
      'Product',
      product.id,
      { product },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    );

    // Log activity for audit trail
    await logActivity({
      entity: 'Product',
      entityId: product.id,
      action: 'CREATE',
      userId: user.id,
      after: product,
    });

    return apiSuccess(product, 'Product created successfully');
  } catch (error) {
    return handleApiError(error, 'Create product');
  }
}

// PUT - Update product (requires update_product permission)
export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }

    if (!checkPermission(user, 'update_product')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const body = await request.json();
    const { id, stock, code: _ignoredCode, ...data } = body;

    // SECURITY: Prevent direct stock manipulation via generic product endpoint
    // Stock must only be modified through inventory operations (invoices, adjustments, etc.)
    if (stock !== undefined) {
      return handleApiError(
        new Error('Cannot modify stock directly. Use inventory operations (invoices, adjustments).'),
        'Update product'
      );
    }

    // Fetch existing product for activity logging
    const existingProduct = await productRepo.findById(id);
    if (!existingProduct || existingProduct.tenantId !== user.tenantId) {
      return apiError('المنتج غير موجود', 404);
    }

    const product = await productRepo.update(id, data);

    // Log audit action
    await logAuditAction(
      user.id,
      'UPDATE',
      'inventory',
      'Product',
      product.id,
      { data },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    );

    // Log activity for audit trail
    await logActivity({
      entity: 'Product',
      entityId: product.id,
      action: 'UPDATE',
      userId: user.id,
      before: existingProduct,
      after: product,
    });

    return apiSuccess(product, 'Product updated successfully');
  } catch (error) {
    return handleApiError(error, 'Update product');
  }
}

// DELETE - Delete product (requires delete_product permission)
export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }

    if (!checkPermission(user, 'delete_product')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return handleApiError(new Error('ID is required'), 'Delete product');
    }

    // Check if product is used in any sales orders, purchase orders, invoices, or production
    const existingProduct = await productRepo.findById(id);
    if (!existingProduct || existingProduct.tenantId !== user.tenantId) {
      return apiError('المنتج غير موجود', 404);
    }

    const usage = await productRepo.countUsage(id);
    const { salesOrderItems, purchaseOrderItems, salesInvoiceItems, purchaseInvoiceItems, inventoryTransactions, productionOrders } = usage;
    const totalUsage = usage.total;

    // Smart delete: if the product is referenced anywhere we keep the row
    // (so historical invoices / orders stay intact) and just mark it inactive.
    // Inventory transactions are pure history — they can be cleaned up only
    // in the hard-delete path.
    let mode: 'hard' | 'soft';
    if (totalUsage > 0) {
      await productRepo.softDelete(id);
      mode = 'soft';
    } else {
      if (inventoryTransactions > 0) {
        await productRepo.deleteInventoryTransactions(id);
      }
      await productRepo.delete(id);
      mode = 'hard';
    }

    // Log audit action
    await logAuditAction(
      user.id,
      mode === 'hard' ? 'DELETE' : 'SOFT_DELETE',
      'inventory',
      'Product',
      id,
      undefined,
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    );

    // Log activity for audit trail (logActivity only knows CREATE/UPDATE/DELETE).
    await logActivity({
      entity: 'Product',
      entityId: id,
      action: 'DELETE',
      userId: user.id,
      before: existingProduct,
    });

    if (mode === 'hard') {
      return apiSuccess({ id, mode }, 'تم حذف المنتج نهائياً');
    }
    const summary: string[] = [];
    if (salesOrderItems     > 0) summary.push(`${salesOrderItems} أمر بيع`);
    if (purchaseOrderItems  > 0) summary.push(`${purchaseOrderItems} أمر شراء`);
    if (salesInvoiceItems   > 0) summary.push(`${salesInvoiceItems} فاتورة بيع`);
    if (purchaseInvoiceItems > 0) summary.push(`${purchaseInvoiceItems} فاتورة شراء`);
    if (inventoryTransactions > 0) summary.push(`${inventoryTransactions} حركة مخزون`);
    if (productionOrders    > 0) summary.push(`${productionOrders} أمر إنتاج`);
    return apiSuccess(
      { id, mode, usage },
      `تم إلغاء تفعيل المنتج (مرتبط بـ ${totalUsage} سجل: ${summary.join('، ')})`,
    );
  } catch (error) {
    return handleApiError(error, 'Delete product');
  }
}
