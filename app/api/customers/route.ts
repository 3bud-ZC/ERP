import { customerRepo } from '@/lib/repositories/customer.repo';
import { CODE_ENTITY_KEYS, allocateEntityCode } from '@/lib/code-sequence.service';

// Disable caching for real-time data
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { logAuditAction, getAuthenticatedUser, checkPermission } from '@/lib/auth';
import { listCustomerBalances, setPartyOpeningBalance } from '@/lib/services/party-debt.service';

// GET - Read customers
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }

    if (!user.tenantId) {
      return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    }

    const customers = await listCustomerBalances(user.tenantId);
    return apiSuccess(customers, 'Customers fetched successfully');
  } catch (error) {
    return handleApiError(error, 'Fetch customers');
  }
}

// POST - Create customer
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }

    if (!checkPermission(user, 'create_customer')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const body = await request.json();
    
    if (!user.tenantId) {
      return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    }
    
    // Remove tenantId from body if present - will be set from user context
    const { tenantId, code: _ignoredCode, ...customerData } = body;

    if (!customerData.nameAr || typeof customerData.nameAr !== 'string' || !customerData.nameAr.trim()) {
      return apiError('الاسم بالعربية مطلوب', 400);
    }

    const code = await allocateEntityCode(CODE_ENTITY_KEYS.CUSTOMER, user.tenantId);

    const customer = await customerRepo.create({
      code,
      nameAr: customerData.nameAr,
      nameEn: customerData.nameEn,
      email: customerData.email,
      phone: customerData.phone,
      address: customerData.address,
      creditLimit: customerData.creditLimit,
      taxNumber: customerData.taxNumber,
      tenantId: user.tenantId,
    });

    await setPartyOpeningBalance({
      tenantId: user.tenantId,
      userId: user.id,
      partyType: 'customer',
      partyId: customer.id,
      openingBalanceType: customerData.openingBalanceType,
      openingBalanceAmount: customerData.openingBalanceAmount,
      openingBalanceDate: customerData.openingBalanceDate,
    });

    await logAuditAction(
      user.id,
      'CREATE',
      'sales',
      'Customer',
      customer.id,
      { customer },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    );

    return apiSuccess(customer, 'Customer created successfully');
  } catch (error: any) {
    // Secure logging only - no console output in production
    return handleApiError(error, 'Create customer');
  }
}

// PUT - Update customer
export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }

    if (!checkPermission(user, 'update_customer')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const body = await request.json();
    const { id, code: _ignoredCode, ...data } = body;

    // SECURITY: Verify customer belongs to user's tenant
    const existingCustomer = await customerRepo.findByIdAndTenant(id, user.tenantId!);
    if (!existingCustomer) {
      return apiError('العميل غير موجود', 404);
    }

    const {
      code: _c,
      openingBalanceType,
      openingBalanceAmount,
      openingBalanceDate,
      ...safeData
    } = data as Record<string, unknown>;
    const customer = await customerRepo.update(id, safeData);

    await setPartyOpeningBalance({
      tenantId: user.tenantId!,
      userId: user.id,
      partyType: 'customer',
      partyId: id,
      openingBalanceType: openingBalanceType as string | undefined,
      openingBalanceAmount: openingBalanceAmount as number | undefined,
      openingBalanceDate: openingBalanceDate as string | undefined,
    });

    await logAuditAction(
      user.id,
      'UPDATE',
      'sales',
      'Customer',
      customer.id,
      { data },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    );

    return apiSuccess(customer, 'Customer updated successfully');
  } catch (error) {
    return handleApiError(error, 'Update customer');
  }
}

// DELETE - Delete customer
export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }

    if (!checkPermission(user, 'delete_customer')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return apiError('Customer ID is required', 400);

    // SECURITY: Verify customer belongs to user's tenant
    const existingCustomer = await customerRepo.findByIdAndTenant(id, user.tenantId!);
    if (!existingCustomer) {
      return apiError('العميل غير موجود', 404);
    }

    // Smart delete (hard if no refs, soft if there are).
    const linked = await customerRepo.countLinkedDocuments(id, user.tenantId!);
    let mode: 'hard' | 'soft';
    if (linked.total > 0) {
      await customerRepo.softDelete(id);
      mode = 'soft';
    } else {
      await customerRepo.delete(id);
      mode = 'hard';
    }

    await logAuditAction(
      user.id,
      mode === 'hard' ? 'DELETE' : 'SOFT_DELETE',
      'sales',
      'Customer',
      id,
      undefined,
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    );

    const msg =
      mode === 'hard'
        ? 'تم حذف العميل نهائياً'
        : `تم إلغاء تفعيل العميل (مرتبط بـ ${linked.total} سجل: ${linked.orders} أمر بيع، ${linked.invoices} فاتورة)`;
    return apiSuccess({ id, mode, linked }, msg);
  } catch (error) {
    return handleApiError(error, 'Delete customer');
  }
}
