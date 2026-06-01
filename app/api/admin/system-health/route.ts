import { prisma } from '@/lib/db';
import { adminSuccess, requirePlatformAdmin } from '@/lib/admin/api';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  let dbStatus: 'up' | 'down' = 'up';
  let dbError: string | null = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error: any) {
    dbStatus = 'down';
    dbError = error?.message || 'Database check failed';
  }

  const [totalTenants, totalUsers, failedActions] = await Promise.all([
    prisma.tenant.count(),
    prisma.user.count(),
    prisma.auditLog.count({
      where: {
        module: {
          in: ['platform_admin', 'admin'],
        },
        status: {
          not: 'success',
        },
      },
    }),
  ]);

  return adminSuccess({
    api: 'up',
    database: dbStatus,
    environment: process.env.NODE_ENV || 'unknown',
    buildVersion: process.env.APP_VERSION || process.env.VERCEL_GIT_COMMIT_SHA || 'local',
    totals: {
      tenants: totalTenants,
      users: totalUsers,
    },
    failedRecentActions: failedActions,
    dbError,
    checkedAt: new Date().toISOString(),
  });
}
