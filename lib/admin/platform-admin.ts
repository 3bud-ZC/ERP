export type AdminTenantStatus = 'active' | 'trial' | 'suspended' | 'expired' | 'deleted';
export type AdminSubscriptionStatus = 'active' | 'trial' | 'expired' | 'cancelled' | 'suspended';

const DEFAULT_PLATFORM_ADMIN = 'admin@erp.com';

export function getPlatformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS || DEFAULT_PLATFORM_ADMIN)
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return getPlatformAdminEmails().includes(email.trim().toLowerCase());
}

export function isPlatformAdmin(user: { email?: string; roles?: string[]; permissions?: string[] } | null): boolean {
  return isPlatformAdminEmail(user?.email);
}

export function normalizeTenantStatus(value: unknown): AdminTenantStatus | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['active', 'trial', 'suspended', 'expired', 'deleted'].includes(normalized)) {
    return normalized as AdminTenantStatus;
  }
  return null;
}

export function deriveSubscriptionStatus(input: {
  tenantStatus?: string | null;
  subscriptionExpiry?: Date | string | null;
}): AdminSubscriptionStatus {
  const tenantStatus = String(input.tenantStatus || '').trim().toLowerCase();
  if (tenantStatus === 'deleted') return 'cancelled';
  if (tenantStatus === 'suspended') return 'suspended';
  if (tenantStatus === 'trial') return 'trial';
  if (tenantStatus === 'expired') return 'expired';

  if (input.subscriptionExpiry) {
    const expiry = new Date(input.subscriptionExpiry);
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() < Date.now()) {
      return 'expired';
    }
  }
  return 'active';
}

export function tenantStatusAllowsAccess(status?: string | null): boolean {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'active' || normalized === 'trial';
}

export function buildTenantCode(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 18);
  const suffix = Date.now().toString(36).toUpperCase();
  return `${normalized || 'client'}-${suffix}`;
}
