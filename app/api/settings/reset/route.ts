import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { checkPermission, getAuthenticatedUser } from '@/lib/auth';
import { getTenantResetPreview, resetTenantOperationalData } from '@/lib/admin/tenant-data-reset';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لا يوجد Tenant مرتبط بالمستخدم', 400);

    const canReset = checkPermission(user, 'manage_system') || user.roles.includes('admin');
    if (!canReset) return apiError('ليس لديك صلاحية تصفير بيانات الشركة', 403);

    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { id: true, tenantCode: true, name: true, nameAr: true },
    });
    if (!tenant) return apiError('بيانات الشركة غير موجودة', 404);

    const preview = await getTenantResetPreview(user.tenantId);
    return apiSuccess({ tenant, preview }, 'معاينة التصفير جاهزة');
  } catch (error) {
    return handleApiError(error, 'Settings reset preview');
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لا يوجد Tenant مرتبط بالمستخدم', 400);

    const canReset = checkPermission(user, 'manage_system') || user.roles.includes('admin');
    if (!canReset) return apiError('ليس لديك صلاحية تصفير بيانات الشركة', 403);

    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { id: true, tenantCode: true, name: true, nameAr: true },
    });
    if (!tenant) return apiError('بيانات الشركة غير موجودة', 404);

    const body = await request.json().catch(() => ({}));
    const confirmation = String((body as any).confirmation || '').trim();
    const expected = `RESET ${tenant.tenantCode}`;
    if (confirmation.toUpperCase() !== expected.toUpperCase()) {
      return apiError(`تأكيد غير صحيح. اكتب بالضبط: ${expected}`, 400);
    }

    const seedAccounting = (body as any).seedAccounting !== false;
    const before = await getTenantResetPreview(user.tenantId);
    await resetTenantOperationalData(user.tenantId, seedAccounting);
    const after = await getTenantResetPreview(user.tenantId);

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        tenantId: user.tenantId,
        action: 'SELF_RESET_TENANT_DATA',
        module: 'settings',
        entityType: 'Tenant',
        entityId: user.tenantId,
        changes: JSON.stringify({ before, after, seedAccounting }),
        status: 'success',
      },
    });

    return apiSuccess({ tenant, before, after }, 'تم تصفير بيانات الشركة بنجاح');
  } catch (error) {
    return handleApiError(error, 'Settings reset');
  }
}
