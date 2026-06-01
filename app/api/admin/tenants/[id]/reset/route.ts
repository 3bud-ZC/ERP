import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';
import { isPlatformAdmin } from '@/lib/admin/platform-admin';
import { getTenantResetPreview, resetTenantOperationalData } from '@/lib/admin/tenant-data-reset';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!isPlatformAdmin(user)) return apiError('غير مصرح بالدخول للوحة الأدمن', 403);

    const tenantId = String(params.id || '').trim();
    if (!tenantId) return apiError('معرف العميل مطلوب', 400);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, tenantCode: true, name: true, nameAr: true },
    });
    if (!tenant) return apiError('العميل غير موجود', 404);

    const preview = await getTenantResetPreview(tenantId);
    return apiSuccess({ tenant, preview }, 'جاهز للمعاينة');
  } catch (error) {
    return handleApiError(error, 'Tenant reset preview');
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!isPlatformAdmin(user)) return apiError('غير مصرح بالدخول للوحة الأدمن', 403);

    const tenantId = String(params.id || '').trim();
    if (!tenantId) return apiError('معرف العميل مطلوب', 400);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, tenantCode: true, name: true, nameAr: true },
    });
    if (!tenant) return apiError('العميل غير موجود', 404);

    const body = await request.json().catch(() => ({}));
    const confirmText = String((body as any).confirmText || '').trim();
    const seedAccounting = (body as any).seedAccounting !== false;
    const expected = tenant.tenantCode;
    if (confirmText.toLowerCase() !== expected.toLowerCase()) {
      return apiError(`تأكيد غير صحيح. اكتب كود العميل بالضبط: ${expected}`, 400);
    }

    const before = await getTenantResetPreview(tenantId);
    await resetTenantOperationalData(tenantId, seedAccounting);

    await prisma.auditLog.create({
      data: {
        userId: user!.id,
        tenantId,
        action: 'RESET_TENANT_DATA',
        module: 'admin',
        entityType: 'Tenant',
        entityId: tenantId,
        changes: JSON.stringify({ before, seedAccounting }),
        status: 'success',
      },
    });

    const after = await getTenantResetPreview(tenantId);
    return apiSuccess({ tenant, before, after }, 'تم تصفير بيانات العميل بنجاح');
  } catch (error) {
    return handleApiError(error, 'Tenant reset');
  }
}
