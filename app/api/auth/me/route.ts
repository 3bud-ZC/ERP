import { apiSuccess, apiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Current session user (no password). */
export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return apiError('لم يتم المصادقة', 401);
  }

  return apiSuccess({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles ?? [],
      permissions: user.permissions ?? [],
      tenantId: user.tenantId,
    },
  });
}
