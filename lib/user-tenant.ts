import { prisma } from './db';
import { tenantStatusAllowsAccess } from './admin/platform-admin';

type TenantRoleCandidate = {
  tenantId?: string | null;
  assignedAt?: Date | null;
  tenant?: { status?: string | null } | null;
  role?: { code?: string | null } | null;
};

function candidateScore(candidate: TenantRoleCandidate, preferredTenantId?: string | null): number {
  let score = 0;

  if (preferredTenantId && candidate.tenantId === preferredTenantId) score += 1000;
  if (tenantStatusAllowsAccess(candidate.tenant?.status)) score += 100;
  if (candidate.role?.code === 'admin') score += 10;

  return score;
}

export function pickPreferredTenantRole<T extends TenantRoleCandidate>(
  candidates: T[],
  preferredTenantId?: string | null,
): T | null {
  return [...candidates]
    .filter((candidate) => Boolean(candidate.tenantId))
    .sort((left, right) => {
      const scoreDiff = candidateScore(right, preferredTenantId) - candidateScore(left, preferredTenantId);
      if (scoreDiff !== 0) return scoreDiff;

      const rightAssigned = right.assignedAt ? new Date(right.assignedAt).getTime() : 0;
      const leftAssigned = left.assignedAt ? new Date(left.assignedAt).getTime() : 0;
      return rightAssigned - leftAssigned;
    })[0] ?? null;
}

export async function getPreferredUserTenantRole(userId: string, preferredTenantId?: string | null) {
  const tenantRoles = await prisma.userTenantRole.findMany({
    where: { userId },
    select: {
      tenantId: true,
      roleId: true,
      assignedAt: true,
      tenant: {
        select: {
          status: true,
        },
      },
      role: {
        select: {
          code: true,
        },
      },
    },
    orderBy: { assignedAt: 'desc' },
  });

  return pickPreferredTenantRole(tenantRoles, preferredTenantId);
}

export async function getPreferredUserTenantId(userId: string, preferredTenantId?: string | null): Promise<string | null> {
  const tenantRole = await getPreferredUserTenantRole(userId, preferredTenantId);
  return tenantRole?.tenantId || null;
}
