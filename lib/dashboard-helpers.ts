import { requireAuth } from './auth';
import { dashboardCache } from './cache';
import { requireOnboarded, isOnboardingExempt } from './tenant-config';
import { getPreferredUserTenantId } from './user-tenant';

async function getUserTenantId(userId: string): Promise<string | null> {
  return getPreferredUserTenantId(userId);
}

export async function enforceOnboarding(req: Request, userId: string) {
  const { pathname } = new URL(req.url);
  if (isOnboardingExempt(pathname)) return;
  const tenantId = await getUserTenantId(userId);
  await requireOnboarded(tenantId);
}

export function getDateRange(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const now = new Date();
  const startDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const endDate = to ? new Date(to) : now;
  return { startDate, endDate };
}

export async function withDashboard<T>(
  req: Request,
  key: string,
  fn: (ctx: { user: any; startDate: Date; endDate: Date }) => Promise<T>,
  ttlSec = 60
): Promise<T> {
  const user = await requireAuth(req);
  await enforceOnboarding(req, user.id);
  const { startDate, endDate } = getDateRange(req);
  const cacheKey = `dash:${key}:${startDate.toISOString()}:${endDate.toISOString()}`;
  const cached = dashboardCache.get(cacheKey);
  if (cached) return cached as T;
  const data = await fn({ user, startDate, endDate });
  dashboardCache.set(cacheKey, data, ttlSec * 1000);
  return data;
}
