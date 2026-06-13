import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pickPreferredTenantRole } from '@/lib/user-tenant';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ADMIN_USERS_ROUTE = path.join(REPO_ROOT, 'app', 'api', 'admin', 'users', 'route.ts');

describe('user tenant selection', () => {
  it('prefers an explicitly requested tenant when it belongs to the user', () => {
    const selected = pickPreferredTenantRole([
      {
        tenantId: 'tenant-suspended',
        assignedAt: new Date('2026-01-01T00:00:00Z'),
        tenant: { status: 'suspended' },
        role: { code: 'accountant' },
      },
      {
        tenantId: 'tenant-active',
        assignedAt: new Date('2026-02-01T00:00:00Z'),
        tenant: { status: 'active' },
        role: { code: 'accountant' },
      },
    ], 'tenant-suspended');

    expect(selected?.tenantId).toBe('tenant-suspended');
  });

  it('prefers active tenants over suspended ones by default', () => {
    const selected = pickPreferredTenantRole([
      {
        tenantId: 'tenant-suspended',
        assignedAt: new Date('2026-02-01T00:00:00Z'),
        tenant: { status: 'suspended' },
        role: { code: 'admin' },
      },
      {
        tenantId: 'tenant-active',
        assignedAt: new Date('2026-01-01T00:00:00Z'),
        tenant: { status: 'active' },
        role: { code: 'accountant' },
      },
    ]);

    expect(selected?.tenantId).toBe('tenant-active');
  });

  it('falls back to the most recent assignment when statuses are equivalent', () => {
    const selected = pickPreferredTenantRole([
      {
        tenantId: 'tenant-old',
        assignedAt: new Date('2026-01-01T00:00:00Z'),
        tenant: { status: 'active' },
        role: { code: 'accountant' },
      },
      {
        tenantId: 'tenant-new',
        assignedAt: new Date('2026-03-01T00:00:00Z'),
        tenant: { status: 'active' },
        role: { code: 'accountant' },
      },
    ]);

    expect(selected?.tenantId).toBe('tenant-new');
  });
});

describe('admin user update contract', () => {
  it('syncs tenant links even when only tenantId changes', () => {
    const source = fs.readFileSync(ADMIN_USERS_ROUTE, 'utf8');
    expect(source).toContain('const nextTenantId = requestedTenantId || existingTenantRole?.tenantId;');
    expect(source).toContain('const nextRoleId = roleId || existingTenantRole?.roleId || existingGlobalRole?.roleId || null;');
    expect(source).toContain('if (nextTenantId && nextRoleId && (roleId || requestedTenantId))');
  });
});
