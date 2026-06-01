import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { checkPermission, getAuthenticatedUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لا يوجد Tenant مرتبط بالمستخدم', 400);

    const [tenant, usersCount, sessionsCount, lastAudit] = await prisma.$transaction([
      prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: {
          id: true,
          tenantCode: true,
          name: true,
          nameAr: true,
          status: true,
          subscriptionPlan: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.userTenantRole.count({ where: { tenantId: user.tenantId } }),
      prisma.session.count({ where: { tenantId: user.tenantId, isActive: true } }),
      prisma.auditLog.findFirst({
        where: { tenantId: user.tenantId },
        select: { createdAt: true, action: true, module: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    if (!tenant) return apiError('بيانات الشركة غير موجودة', 404);

    const canReset = checkPermission(user, 'manage_system') || user.roles.includes('admin');

    return apiSuccess({
      tenant,
      usersCount,
      activeSessions: sessionsCount,
      canReset,
      lastActivity: lastAudit,
      serverTime: new Date().toISOString(),
    }, 'تم تحميل إعدادات النظام');
  } catch (error) {
    return handleApiError(error, 'Settings overview');
  }
}
