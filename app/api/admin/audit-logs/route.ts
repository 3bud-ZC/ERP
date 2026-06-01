import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { adminSuccess, parsePositiveInt, requirePlatformAdmin } from '@/lib/admin/api';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 1, 10000);
  const limit = parsePositiveInt(url.searchParams.get('limit'), 30, 1, 200);
  const skip = (page - 1) * limit;
  const search = String(url.searchParams.get('search') || '').trim();
  const action = String(url.searchParams.get('action') || '').trim();

  const where: Prisma.AuditLogWhereInput = {
    module: {
      in: ['platform_admin', 'admin'],
    },
  };
  if (action && action !== 'all') {
    where.action = action;
  }
  if (search) {
    where.OR = [
      { action: { contains: search, mode: 'insensitive' } },
      { entityType: { contains: search, mode: 'insensitive' } },
      { entityId: { contains: search, mode: 'insensitive' } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
      { user: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        action: true,
        module: true,
        entityType: true,
        entityId: true,
        status: true,
        changes: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return adminSuccess({
    rows,
    meta: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  });
}
