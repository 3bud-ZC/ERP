import { supplierRepo } from '@/lib/repositories/supplier.repo';
import { CODE_ENTITY_KEYS, allocateEntityCode } from '@/lib/code-sequence.service';

// Disable caching for real-time data
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { logAuditAction, getAuthenticatedUser, checkPermission } from '@/lib/auth';
import { listSupplierBalances, setPartyOpeningBalance } from '@/lib/services/party-debt.service';

// GET - Read suppliers
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }

    if (!user.tenantId) {
      return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    }

    const suppliers = await listSupplierBalances(user.tenantId);
    return apiSuccess(suppliers, 'Suppliers fetched successfully');
  } catch (error) {
    return handleApiError(error, 'Fetch suppliers');
  }
}

// POST - Create supplier
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }

    if (!checkPermission(user, 'create_supplier')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    if (!user.tenantId) {
      return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    }

    const body = await request.json();
    const { tenantId: _t, code: _ignoredCode, ...supplierData } = body;

    if (!supplierData.nameAr || typeof supplierData.nameAr !== 'string' || !supplierData.nameAr.trim()) {
      return apiError('الاسم بالعربية مطلوب', 400);
    }

    const code = await allocateEntityCode(CODE_ENTITY_KEYS.SUPPLIER, user.tenantId);

    const supplier = await supplierRepo.create({
      code,
      nameAr: supplierData.nameAr,
      ...(supplierData.nameEn && { nameEn: supplierData.nameEn }),
      ...(supplierData.phone && { phone: supplierData.phone }),
      ...(supplierData.email && { email: supplierData.email }),
      ...(supplierData.creditLimit != null && { creditLimit: Number(supplierData.creditLimit) }),
      ...(supplierData.address && { address: supplierData.address }),
      tenantId: user.tenantId,
    });

    await setPartyOpeningBalance({
      tenantId: user.tenantId,
      userId: user.id,
      partyType: 'supplier',
      partyId: supplier.id,
      openingBalanceType: supplierData.openingBalanceType,
      openingBalanceAmount: supplierData.openingBalanceAmount,
      openingBalanceDate: supplierData.openingBalanceDate,
    });

    await logAuditAction(
      user.id,
      'CREATE',
      'purchases',
      'Supplier',
      supplier.id,
      { supplier },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    );

    return apiSuccess(supplier, 'Supplier created successfully');
  } catch (error) {
    return handleApiError(error, 'Create supplier');
  }
}

// PUT - Update supplier
export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }

    if (!checkPermission(user, 'update_supplier')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const body = await request.json();
    const { id, code: _ignoredCode, ...data } = body;

    // SECURITY: Verify supplier belongs to user's tenant
    const existingSupplier = await supplierRepo.findByIdAndTenant(id, user.tenantId!);
    if (!existingSupplier) {
      return apiError('المورد غير موجود', 404);
    }

    const {
      code: _c,
      openingBalanceType,
      openingBalanceAmount,
      openingBalanceDate,
      ...safeData
    } = data as Record<string, unknown>;
    const supplier = await supplierRepo.update(id, safeData);

    await setPartyOpeningBalance({
      tenantId: user.tenantId!,
      userId: user.id,
      partyType: 'supplier',
      partyId: id,
      openingBalanceType: openingBalanceType as string | undefined,
      openingBalanceAmount: openingBalanceAmount as number | undefined,
      openingBalanceDate: openingBalanceDate as string | undefined,
    });

    await logAuditAction(
      user.id,
      'UPDATE',
      'purchases',
      'Supplier',
      supplier.id,
      { data },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    );

    return apiSuccess(supplier, 'Supplier updated successfully');
  } catch (error) {
    return handleApiError(error, 'Update supplier');
  }
}

// DELETE - Delete supplier
export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }

    if (!checkPermission(user, 'delete_supplier')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return handleApiError(new Error('ID is required'), 'Delete supplier');
    }

    // SECURITY: Verify supplier belongs to user's tenant
    const existingSupplier = await supplierRepo.findByIdAndTenant(id, user.tenantId!);
    if (!existingSupplier) {
      return apiError('المورد غير موجود', 404);
    }

    // Smart delete: hard-delete when there are no related rows; otherwise
    // soft-delete (mark inactive) so historical purchase orders / invoices
    // keep their FK references intact.
    const linked = await supplierRepo.countLinkedDocuments(id, user.tenantId!);
    let mode: 'hard' | 'soft';
    if (linked.total > 0) {
      await supplierRepo.softDelete(id);
      mode = 'soft';
    } else {
      await supplierRepo.delete(id);
      mode = 'hard';
    }

    await logAuditAction(
      user.id,
      mode === 'hard' ? 'DELETE' : 'SOFT_DELETE',
      'purchases',
      'Supplier',
      id,
      undefined,
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    );

    const msg =
      mode === 'hard'
        ? 'تم حذف المورد نهائياً'
        : `تم إلغاء تفعيل المورد (مرتبط بـ ${linked.total} سجل: ${linked.orders} أمر شراء، ${linked.invoices} فاتورة)`;
    return apiSuccess({ id, mode, linked }, msg);
  } catch (error) {
    return handleApiError(error, 'Delete supplier');
  }
}
