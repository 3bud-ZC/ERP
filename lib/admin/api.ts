import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth';
import { isPlatformAdmin } from '@/lib/admin/platform-admin';
import { toArabicError } from '@/lib/utils/arabic-errors';

export type PlatformAdminUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
  tenantId?: string;
};

export function adminSuccess<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(
    {
      success: true,
      data,
      error: null,
    },
    init,
  );
}

export function adminError(message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    {
      success: false,
      data: null,
      error: toArabicError(message, message),
      ...(details ? { details } : {}),
    },
    { status },
  );
}

export async function requirePlatformAdmin(request: Request): Promise<
  { ok: true; user: PlatformAdminUser } | { ok: false; response: NextResponse }
> {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    return { ok: false, response: adminError('لم يتم تسجيل الدخول', 401) };
  }
  if (!isPlatformAdmin(user)) {
    return { ok: false, response: adminError('غير مصرح بالدخول إلى لوحة إدارة المنصة', 403) };
  }
  return { ok: true, user };
}

export function parsePositiveInt(input: unknown, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
