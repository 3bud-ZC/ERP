'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Ban,
  Building2,
  CheckCircle2,
  Clock3,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';

type AdminSection =
  | 'overview'
  | 'tenants'
  | 'users'
  | 'logs'
  | 'health'
  | 'settings';

type TenantRow = {
  id: string;
  tenantCode: string;
  name: string;
  nameAr?: string | null;
  email?: string | null;
  status: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  subscriptionExpiry?: string | null;
  limits?: { maxUsers: number; maxProducts: number };
  owner?: { id: string; name?: string | null; email: string; isActive?: boolean; lastLogin?: string | null } | null;
  counts?: {
    users: number;
    products: number;
    warehouses: number;
    customers: number;
    suppliers: number;
    salesInvoices: number;
    purchaseInvoices: number;
  };
  createdAt: string;
};

type UserRow = {
  id: string;
  name?: string | null;
  email: string;
  isActive: boolean;
  status?: string;
  lastLogin?: string | null;
  createdAt: string;
  roles: Array<{ role: { code: string; nameAr?: string | null } }>;
  userTenantRoles: Array<{
    tenantId: string;
    tenant: { id: string; name: string; nameAr?: string | null; tenantCode: string; status: string };
    role: { code: string; nameAr?: string | null };
  }>;
};

type AuditRow = {
  id: string;
  action: string;
  module: string;
  entityType: string;
  entityId?: string | null;
  status: string;
  createdAt: string;
  user?: { name?: string | null; email: string } | null;
};

type OverviewCards = {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  trialTenants: number;
  deletedTenants: number;
  expiredSubscriptions: number;
  totalUsers: number;
  activeUsers: number;
  revenueEstimate: number;
  systemHealth: string;
};

const TENANT_STATUS_OPTIONS = ['active', 'trial', 'suspended', 'expired', 'deleted'];

const EMPTY_CARDS: OverviewCards = {
  totalTenants: 0,
  activeTenants: 0,
  suspendedTenants: 0,
  trialTenants: 0,
  deletedTenants: 0,
  expiredSubscriptions: 0,
  totalUsers: 0,
  activeUsers: 0,
  revenueEstimate: 0,
  systemHealth: 'unknown',
};

const sections: Array<{ key: AdminSection; label: string }> = [
  { key: 'overview', label: 'لوحة المنصة' },
  { key: 'tenants', label: 'العملاء / الشركات' },
  { key: 'users', label: 'المستخدمون' },
  { key: 'logs', label: 'سجل الإجراءات' },
  { key: 'health', label: 'صحة النظام' },
  { key: 'settings', label: 'الإعدادات' },
];

export default function PlatformAdminPage() {
  const router = useRouter();
  const [section, setSection] = useState<AdminSection>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState<{ email: string; password: string } | null>(null);

  const [overviewCards, setOverviewCards] = useState<OverviewCards>(EMPTY_CARDS);
  const [overviewWidgets, setOverviewWidgets] = useState<any>({});
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [health, setHealth] = useState<any>(null);

  const [tenantSearch, setTenantSearch] = useState('');
  const [tenantStatusFilter, setTenantStatusFilter] = useState('all');

  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('all');
  const [userStatusFilter, setUserStatusFilter] = useState('all');
  const [userTenantFilter, setUserTenantFilter] = useState('all');

  const [createTenantForm, setCreateTenantForm] = useState({
    companyName: '',
    companyNameAr: '',
    ownerName: '',
    ownerEmail: '',
    ownerPhone: '',
    password: '',
    notes: '',
  });

  const [createUserForm, setCreateUserForm] = useState({
    tenantId: '',
    name: '',
    email: '',
    password: '',
    role: 'manager',
    status: 'active',
  });

  const activeTenants = useMemo(
    () => tenants.filter((t) => t.status === 'active' || t.status === 'trial'),
    [tenants],
  );

  const tenantMap = useMemo(() => {
    const map = new Map<string, TenantRow>();
    tenants.forEach((tenant) => map.set(tenant.id, tenant));
    return map;
  }, [tenants]);

  const visibleTenants = useMemo(() => {
    return tenants.filter((tenant) => {
      if (tenantStatusFilter !== 'all' && tenant.status !== tenantStatusFilter) return false;
      if (tenantSearch) {
        const q = tenantSearch.toLowerCase();
        const text = `${tenant.nameAr || ''} ${tenant.name || ''} ${tenant.tenantCode || ''} ${tenant.email || ''}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [tenants, tenantSearch, tenantStatusFilter]);

  const visibleUsers = useMemo(() => {
    return users.filter((user) => {
      if (userRoleFilter !== 'all' && !(user.roles || []).some((row) => row.role.code === userRoleFilter)) return false;
      if (userStatusFilter !== 'all') {
        const status = user.isActive ? 'active' : 'suspended';
        if (status !== userStatusFilter) return false;
      }
      if (userTenantFilter !== 'all') {
        if (!(user.userTenantRoles || []).some((link) => link.tenantId === userTenantFilter)) return false;
      }
      if (userSearch) {
        const q = userSearch.toLowerCase();
        const text = `${user.name || ''} ${user.email}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [userRoleFilter, userSearch, userStatusFilter, userTenantFilter, users]);

  async function fetchJson(url: string, init?: RequestInit) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...init });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok || !json?.success) {
      const message = json?.error || json?.message || (text && text.length < 300 ? text : 'فشل تنفيذ الطلب');
      if (res.status === 403) {
        router.replace('/dashboard');
      }
      throw new Error(message);
    }
    return json.data;
  }

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [overview, tenantsData, usersData, logsData, healthData] = await Promise.all([
        fetchJson('/api/admin/overview'),
        fetchJson('/api/admin/tenants?limit=200'),
        fetchJson('/api/admin/users?limit=300'),
        fetchJson('/api/admin/audit-logs?limit=50'),
        fetchJson('/api/admin/system-health'),
      ]);

      setOverviewCards(overview?.cards || EMPTY_CARDS);
      setOverviewWidgets(overview?.widgets || {});
      setTenants(tenantsData?.rows || []);
      setUsers(usersData?.rows || []);
      setAuditLogs(logsData?.rows || []);
      setHealth(healthData || null);
    } catch (e: any) {
      setError(e.message || 'تعذر تحميل بيانات إدارة المنصة');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function startBusy(key: string) {
    setBusy(key);
    setError('');
    setSuccess('');
    setGeneratedPassword(null);
  }

  function stopBusy() {
    setBusy('');
  }

  async function createTenant(e: React.FormEvent) {
    e.preventDefault();
    startBusy('create-tenant');
    try {
      const data = await fetchJson('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createTenantForm),
      });
      setSuccess('تم إنشاء العميل بنجاح');
      if (data?.generatedPassword) {
        setGeneratedPassword({ email: data.owner?.email || createTenantForm.ownerEmail, password: data.generatedPassword });
      }
      setCreateTenantForm({
        companyName: '',
        companyNameAr: '',
        ownerName: '',
        ownerEmail: '',
        ownerPhone: '',
        password: '',
        notes: '',
      });
      await loadAll();
    } catch (e: any) {
      setError(e.message || 'فشل إنشاء العميل');
    } finally {
      stopBusy();
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    startBusy('create-user');
    try {
      const data = await fetchJson('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createUserForm),
      });
      setSuccess('تم إنشاء المستخدم بنجاح');
      if (data?.generatedPassword) {
        setGeneratedPassword({ email: data.email || createUserForm.email, password: data.generatedPassword });
      }
      setCreateUserForm({
        tenantId: '',
        name: '',
        email: '',
        password: '',
        role: 'manager',
        status: 'active',
      });
      await loadAll();
    } catch (e: any) {
      setError(e.message || 'فشل إنشاء المستخدم');
    } finally {
      stopBusy();
    }
  }

  async function runTenantAction(tenant: TenantRow, action: string, payload?: Record<string, unknown>) {
    const isPlatformOwnerTenant = (tenant.tenantCode || '').toLowerCase() === 'default';
    if (isPlatformOwnerTenant && ['soft_delete', 'hard_delete', 'suspend'].includes(action)) {
      setError('لا يمكن تنفيذ هذا الإجراء على حساب مالك النظام.');
      return;
    }
    const actionLabel =
      action === 'suspend'
        ? 'إيقاف العميل'
        : action === 'reactivate'
          ? 'إعادة تفعيل العميل'
          : action === 'soft_delete'
            ? 'حذف العميل (تعطيل مع حفظ البيانات)'
            : action === 'hard_delete'
              ? 'حذف نهائي للعميل'
            : action === 'restore'
              ? 'استرجاع العميل'
              : action === 'reset_owner_password'
                ? 'إعادة تعيين كلمة مرور المالك'
                : 'تحديث العميل';
    const confirm = window.confirm(
      `${actionLabel}\n` +
      `العميل: ${tenant.nameAr || tenant.name}\n` +
      (action === 'soft_delete'
        ? 'سيتم إيقاف الوصول مع الاحتفاظ بكامل بيانات ERP.'
        : action === 'hard_delete'
          ? 'سيتم حذف العميل نهائياً فقط إذا كان بدون بيانات تشغيل. سيُطلب تأكيد إضافي.'
          : 'تأكد من تنفيذ الإجراء.'),
    );
    if (!confirm) return;

    const extraPayload: Record<string, unknown> = { ...(payload || {}) };
    if (action === 'hard_delete') {
      const typed = window.prompt(`للتأكيد اكتب: DELETE ${tenant.tenantCode}`);
      if (!typed) return;
      extraPayload.confirmText = typed;
    }

    startBusy(`tenant-${tenant.id}-${action}`);
    try {
      const data = await fetchJson(`/api/admin/tenants/${tenant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extraPayload }),
      });
      setSuccess('تم تنفيذ الإجراء بنجاح');
      if (data?.generatedPassword) {
        setGeneratedPassword({ email: data.ownerEmail || tenant.owner?.email || '', password: data.generatedPassword });
      }
      await loadAll();
    } catch (e: any) {
      setError(e.message || 'فشل تنفيذ الإجراء');
    } finally {
      stopBusy();
    }
  }

  async function updateTenantBasics(tenant: TenantRow, patch: Record<string, unknown>) {
    startBusy(`tenant-update-${tenant.id}`);
    try {
      await fetchJson('/api/admin/tenants', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tenant.id, ...patch }),
      });
      setSuccess('تم تحديث العميل');
      await loadAll();
    } catch (e: any) {
      setError(e.message || 'فشل تحديث العميل');
    } finally {
      stopBusy();
    }
  }

  async function runUserAction(user: UserRow, action: string, payload?: Record<string, unknown>) {
    const label =
      action === 'suspend'
        ? 'إيقاف المستخدم'
        : action === 'activate'
          ? 'تفعيل المستخدم'
          : action === 'soft_delete'
            ? 'تعطيل المستخدم'
            : action === 'reset_password'
              ? 'إعادة تعيين كلمة المرور'
              : 'تحديث المستخدم';

    const confirm = window.confirm(`${label}\nالمستخدم: ${user.email}`);
    if (!confirm) return;

    startBusy(`user-${user.id}-${action}`);
    try {
      if (action === 'soft_delete') {
        await fetchJson('/api/admin/users', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: user.id }),
        });
      } else if (action === 'reset_password') {
        const suggested = Math.random().toString(36).slice(2, 10) + 'A1!';
        const entered = window.prompt('اكتب كلمة المرور الجديدة (اتركها فارغة للتوليد التلقائي):', suggested);
        const data = await fetchJson('/api/admin/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: user.id, action: 'reset_password', password: entered || undefined }),
        });
        if (data?.generatedPassword) {
          setGeneratedPassword({ email: user.email, password: data.generatedPassword });
        }
      } else {
        await fetchJson('/api/admin/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: user.id, action, ...payload }),
        });
      }
      setSuccess('تم تنفيذ الإجراء على المستخدم');
      await loadAll();
    } catch (e: any) {
      setError(e.message || 'فشل تنفيذ الإجراء');
    } finally {
      stopBusy();
    }
  }

  async function resetTenantOperationalData(tenant: TenantRow) {
    const previewConfirm = window.confirm(
      `تصفير بيانات العميل ${tenant.nameAr || tenant.name}\n` +
      'سيتم حذف البيانات التشغيلية مع الاحتفاظ بالعميل ومستخدميه.',
    );
    if (!previewConfirm) return;
    startBusy(`reset-${tenant.id}`);
    try {
      const preview = await fetchJson(`/api/admin/tenants/${tenant.id}/reset`);
      const expected = preview?.tenant?.tenantCode || tenant.tenantCode;
      const typed = window.prompt(`للتأكيد اكتب كود العميل التالي: ${expected}`);
      if (!typed) return;
      await fetchJson(`/api/admin/tenants/${tenant.id}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmText: typed, seedAccounting: true }),
      });
      setSuccess('تم تصفير بيانات العميل بنجاح');
      await loadAll();
    } catch (e: any) {
      setError(e.message || 'فشل تصفير بيانات العميل');
    } finally {
      stopBusy();
    }
  }

  async function refreshData() {
    startBusy('refresh');
    try {
      await loadAll();
      setSuccess('تم تحديث البيانات');
    } finally {
      stopBusy();
    }
  }

  function renderOverview() {
    return (
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          <MetricCard title="إجمالي العملاء" value={overviewCards.totalTenants} icon={<Building2 className="h-4 w-4" />} />
          <MetricCard title="عملاء نشطون" value={overviewCards.activeTenants} icon={<BadgeCheck className="h-4 w-4" />} />
          <MetricCard title="عملاء موقوفون" value={overviewCards.suspendedTenants} icon={<Ban className="h-4 w-4" />} />
          <MetricCard title="اشتراكات منتهية" value={overviewCards.expiredSubscriptions} icon={<Clock3 className="h-4 w-4" />} />
          <MetricCard title="إجمالي المستخدمين" value={overviewCards.totalUsers} icon={<Users className="h-4 w-4" />} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="آخر العملاء">
            <SimpleTable
              headers={['الشركة', 'الكود', 'الحالة', 'الخطة']}
              rows={(overviewWidgets.recentTenants || []).map((row: any) => [
                row.nameAr || row.name,
                row.tenantCode,
                row.status,
                row.subscriptionPlan,
              ])}
            />
          </Panel>
          <Panel title="أحدث المستخدمين">
            <SimpleTable
              headers={['المستخدم', 'الشركة', 'الحالة']}
              rows={(overviewWidgets.recentUsers || []).map((row: any) => [
                row.email,
                row.userTenantRoles?.[0]?.tenant?.nameAr || row.userTenantRoles?.[0]?.tenant?.name || '—',
                row.isActive ? 'نشط' : 'موقوف',
              ])}
            />
          </Panel>
        </div>
      </div>
    );
  }

  function renderTenants() {
    return (
      <div className="space-y-5">
        <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
          <Panel title="إنشاء عميل جديد">
            <form className="space-y-3" onSubmit={createTenant}>
              <Input label="اسم الشركة" value={createTenantForm.companyName} onChange={(value) => setCreateTenantForm((prev) => ({ ...prev, companyName: value }))} required />
              <Input label="اسم الشركة بالعربية" value={createTenantForm.companyNameAr} onChange={(value) => setCreateTenantForm((prev) => ({ ...prev, companyNameAr: value }))} required />
              <Input label="اسم مالك الحساب" value={createTenantForm.ownerName} onChange={(value) => setCreateTenantForm((prev) => ({ ...prev, ownerName: value }))} required />
              <Input label="بريد مالك الحساب" type="email" value={createTenantForm.ownerEmail} onChange={(value) => setCreateTenantForm((prev) => ({ ...prev, ownerEmail: value }))} required />
              <Input label="هاتف المالك" value={createTenantForm.ownerPhone} onChange={(value) => setCreateTenantForm((prev) => ({ ...prev, ownerPhone: value }))} />
              <Input label="كلمة المرور (اختياري)" value={createTenantForm.password} onChange={(value) => setCreateTenantForm((prev) => ({ ...prev, password: value }))} />
              <label className="block text-xs font-semibold text-slate-600">
                ملاحظات
                <textarea
                  value={createTenantForm.notes}
                  onChange={(e) => setCreateTenantForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="mt-1 h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500"
                />
              </label>
              <button
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                disabled={busy === 'create-tenant'}
              >
                {busy === 'create-tenant' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                إنشاء العميل
              </button>
            </form>
          </Panel>

          <Panel title="إدارة العملاء / الشركات">
            <div className="mb-3 grid gap-2 md:grid-cols-3">
              <Input label="بحث" value={tenantSearch} onChange={setTenantSearch} placeholder="الاسم أو الكود أو البريد" />
              <Select label="الحالة" value={tenantStatusFilter} onChange={setTenantStatusFilter} options={['all', ...TENANT_STATUS_OPTIONS]} optionLabels={{ all: 'الكل' }} />
            </div>
            <div className="overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-right">الشركة</th>
                    <th className="px-3 py-2 text-right">المالك</th>
                    <th className="px-3 py-2 text-right">الحالة</th>
                    <th className="px-3 py-2 text-center">المستخدمون</th>
                    <th className="px-3 py-2 text-right">آخر نشاط</th>
                    <th className="px-3 py-2 text-right">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleTenants.map((tenant) => (
                    <tr key={tenant.id}>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900">{tenant.nameAr || tenant.name}</div>
                        <div className="text-xs text-slate-500">{tenant.tenantCode}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-slate-800">{tenant.owner?.name || '—'}</div>
                        <div className="text-xs text-slate-500">{tenant.owner?.email || '—'}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClassForStatus(tenant.status)}`}>
                          {tenant.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {(tenant.counts?.users || 0)}/{tenant.limits?.maxUsers || 0}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{formatDate(tenant.owner?.lastLogin || tenant.createdAt)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          <ActionButton
                            label={tenant.status === 'suspended' ? 'تفعيل' : 'تعليق'}
                            onClick={() => runTenantAction(tenant, tenant.status === 'suspended' ? 'reactivate' : 'suspend')}
                            busy={busy.startsWith(`tenant-${tenant.id}`)}
                          />
                          <ActionButton label="إعادة باسورد المالك" onClick={() => runTenantAction(tenant, 'reset_owner_password')} />
                          <ActionButton label="إدارة المستخدمين" onClick={() => setSection('users')} />
                          <ActionButton label="تصفير" danger onClick={() => resetTenantOperationalData(tenant)} />
                          <ActionButton
                            label="تعطيل"
                            danger
                            onClick={() => runTenantAction(tenant, 'soft_delete')}
                          />
                          <ActionButton
                            label="حذف نهائي"
                            danger
                            onClick={() => runTenantAction(tenant, 'hard_delete')}
                          />
                          {tenant.status === 'deleted' && (
                            <ActionButton label="استرجاع" onClick={() => runTenantAction(tenant, 'restore')} />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && visibleTenants.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">لا توجد شركات مطابقة.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  function renderUsers() {
    return (
      <div className="space-y-5">
        <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
          <Panel title="إضافة مستخدم">
            <form className="space-y-3" onSubmit={createUser}>
              <Select
                label="الشركة"
                value={createUserForm.tenantId}
                onChange={(value) => setCreateUserForm((prev) => ({ ...prev, tenantId: value }))}
                options={activeTenants.map((tenant) => tenant.id)}
                optionLabels={Object.fromEntries(activeTenants.map((tenant) => [tenant.id, `${tenant.nameAr || tenant.name} (${tenant.tenantCode})`]))}
                required
              />
              <Input label="الاسم" value={createUserForm.name} onChange={(value) => setCreateUserForm((prev) => ({ ...prev, name: value }))} required />
              <Input label="البريد" type="email" value={createUserForm.email} onChange={(value) => setCreateUserForm((prev) => ({ ...prev, email: value }))} required />
              <Input label="كلمة المرور (اختياري)" value={createUserForm.password} onChange={(value) => setCreateUserForm((prev) => ({ ...prev, password: value }))} />
              <Select
                label="الدور"
                value={createUserForm.role}
                onChange={(value) => setCreateUserForm((prev) => ({ ...prev, role: value }))}
                options={['admin', 'manager', 'accountant', 'inventory_manager', 'sales_rep', 'purchase_officer']}
              />
              <Select
                label="الحالة"
                value={createUserForm.status}
                onChange={(value) => setCreateUserForm((prev) => ({ ...prev, status: value }))}
                options={['active', 'suspended']}
              />
              <button
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                disabled={busy === 'create-user'}
              >
                {busy === 'create-user' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                إنشاء مستخدم
              </button>
            </form>
          </Panel>

          <Panel title="إدارة المستخدمين">
            <div className="mb-3 grid gap-2 md:grid-cols-4">
              <Input label="بحث" value={userSearch} onChange={setUserSearch} placeholder="الاسم أو البريد" />
              <Select label="الدور" value={userRoleFilter} onChange={setUserRoleFilter} options={['all', 'admin', 'manager', 'accountant', 'inventory_manager', 'sales_rep', 'purchase_officer']} optionLabels={{ all: 'الكل' }} />
              <Select label="الحالة" value={userStatusFilter} onChange={setUserStatusFilter} options={['all', 'active', 'suspended']} optionLabels={{ all: 'الكل' }} />
              <Select
                label="الشركة"
                value={userTenantFilter}
                onChange={setUserTenantFilter}
                options={['all', ...tenants.map((tenant) => tenant.id)]}
                optionLabels={{
                  all: 'الكل',
                  ...Object.fromEntries(tenants.map((tenant) => [tenant.id, tenant.nameAr || tenant.name])),
                }}
              />
            </div>
            <div className="overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-right">المستخدم</th>
                    <th className="px-3 py-2 text-right">الشركة</th>
                    <th className="px-3 py-2 text-right">الدور</th>
                    <th className="px-3 py-2 text-right">الحالة</th>
                    <th className="px-3 py-2 text-right">آخر دخول</th>
                    <th className="px-3 py-2 text-right">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleUsers.map((user) => {
                    const tenant = user.userTenantRoles?.[0]?.tenant;
                    const role = user.roles?.[0]?.role;
                    return (
                      <tr key={user.id}>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-900">{user.name || '—'}</div>
                          <div className="text-xs text-slate-500">{user.email}</div>
                        </td>
                        <td className="px-3 py-2 text-slate-700">{tenant?.nameAr || tenant?.name || '—'}</td>
                        <td className="px-3 py-2">{role?.nameAr || role?.code || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${user.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                            {user.isActive ? 'نشط' : 'موقوف'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">{formatDate(user.lastLogin || user.createdAt)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            <ActionButton label={user.isActive ? 'تعليق' : 'تفعيل'} onClick={() => runUserAction(user, user.isActive ? 'suspend' : 'activate')} />
                            <ActionButton label="إعادة باسورد" onClick={() => runUserAction(user, 'reset_password')} />
                            <ActionButton label="حذف منطقي" danger onClick={() => runUserAction(user, 'soft_delete')} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && visibleUsers.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">لا يوجد مستخدمون.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  function renderAccessControl() {
    return (
      <Panel title="حالة الحسابات والتحكم بالوصول">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-bold text-slate-800">حسابات العملاء الموقوفة</h3>
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              {tenants.filter((tenant) => ['suspended', 'deleted', 'expired'].includes(tenant.status)).slice(0, 10).map((tenant) => (
                <li key={tenant.id} className="flex items-center justify-between">
                  <span>{tenant.nameAr || tenant.name}</span>
                  <ActionButton label="استرجاع" onClick={() => runTenantAction(tenant, 'restore')} />
                </li>
              ))}
              {tenants.filter((tenant) => ['suspended', 'deleted', 'expired'].includes(tenant.status)).length === 0 && (
                <li className="text-slate-500">لا توجد حسابات موقوفة حالياً.</li>
              )}
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-bold text-slate-800">مستخدمون موقوفون</h3>
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              {users.filter((user) => !user.isActive).slice(0, 10).map((user) => (
                <li key={user.id} className="flex items-center justify-between">
                  <span>{user.email}</span>
                  <ActionButton label="تفعيل" onClick={() => runUserAction(user, 'activate')} />
                </li>
              ))}
              {users.filter((user) => !user.isActive).length === 0 && (
                <li className="text-slate-500">لا يوجد مستخدمون موقوفون.</li>
              )}
            </ul>
          </div>
        </div>
      </Panel>
    );
  }

  function renderLogs() {
    return (
      <Panel title="سجل إجراءات الأدمن">
        <div className="overflow-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 text-right">الوقت</th>
                <th className="px-3 py-2 text-right">المسؤول</th>
                <th className="px-3 py-2 text-right">الإجراء</th>
                <th className="px-3 py-2 text-right">الكيان</th>
                <th className="px-3 py-2 text-right">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td className="px-3 py-2 text-xs text-slate-600">{formatDateTime(log.createdAt)}</td>
                  <td className="px-3 py-2">{log.user?.name || log.user?.email || '—'}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{log.action}</td>
                  <td className="px-3 py-2">{log.entityType} {log.entityId ? `(${log.entityId.slice(0, 8)})` : ''}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${log.status === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                      {log.status}
                    </span>
                  </td>
                </tr>
              ))}
              {auditLogs.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">لا توجد سجلات حالياً.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    );
  }

  function renderHealth() {
    return (
      <Panel title="فحوصات المنصة">
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard title="API" value={health?.api === 'up' ? 'UP' : 'DOWN'} icon={<Activity className="h-4 w-4" />} />
          <MetricCard title="قاعدة البيانات" value={health?.database === 'up' ? 'UP' : 'DOWN'} icon={<Shield className="h-4 w-4" />} />
          <MetricCard title="إصدار البناء" value={health?.buildVersion || 'local'} icon={<Settings className="h-4 w-4" />} />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="text-slate-500">إجمالي العملاء</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{health?.totals?.tenants ?? 0}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="text-slate-500">إجمالي المستخدمين</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{health?.totals?.users ?? 0}</div>
          </div>
        </div>
        {health?.dbError && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{health.dbError}</div>
        )}
      </Panel>
    );
  }

  function renderSettings() {
    return (
      <Panel title="إعدادات إدارة المنصة">
        <div className="grid gap-3 md:grid-cols-2">
          <button onClick={refreshData} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <RefreshCw className="mr-1 inline h-4 w-4" />
            تحديث كل البيانات
          </button>
          <button
            onClick={async () => {
              const confirm1 = window.prompt('اكتب WIPE ALL للتأكيد');
              if ((confirm1 || '').trim().toUpperCase() !== 'WIPE ALL') return;
              const confirm2 = window.prompt('اكتب بريد مالك النظام للتأكيد');
              if (!confirm2) return;
              startBusy('wipe');
              try {
                await fetchJson('/api/admin/system/wipe', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    confirmText: 'WIPE ALL',
                    confirmEmail: confirm2.trim(),
                    confirmCode: Math.random().toString(36).slice(2, 8).toUpperCase(),
                  }),
                });
                setSuccess('تم تنفيذ تصفير المنصة');
                await loadAll();
              } catch (e: any) {
                setError(e.message || 'فشل تصفير المنصة');
              } finally {
                stopBusy();
              }
            }}
            className="rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 hover:bg-red-100"
          >
            <Trash2 className="mr-1 inline h-4 w-4" />
            تصفير كامل المنصة
          </button>
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          جميع الإجراءات الحرجة تتطلب تأكيد، ولا يتم حذف بيانات ERP نهائياً من واجهة الإدارة الافتراضية.
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-6 pb-12" dir="rtl">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-900">منصة إدارة العملاء</h1>
            <p className="mt-1 text-sm text-slate-500">لوحة Super Admin لإدارة الشركات والمستخدمين وصحة المنصة.</p>
            <p className="mt-1 text-xs font-bold text-sky-700">ADMIN UI v2</p>
          </div>
          <button
            onClick={refreshData}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {busy === 'refresh' || loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            تحديث
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {sections.map((item) => (
            <button
              key={item.key}
              onClick={() => setSection(item.key)}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
                section === item.key
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700">{error}</div>
      )}
      {success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700">{success}</div>
      )}
      {generatedPassword && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <div className="font-bold">بيانات دخول جديدة (تظهر مرة واحدة)</div>
          <div className="mt-1">Email: {generatedPassword.email}</div>
          <div>Password: {generatedPassword.password}</div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
        </div>
      ) : (
        <>
          {section === 'overview' && renderOverview()}
          {section === 'tenants' && renderTenants()}
          {section === 'users' && renderUsers()}
          {section === 'logs' && renderLogs()}
          {section === 'health' && renderHealth()}
          {section === 'settings' && renderSettings()}
        </>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-2">
        <Shield className="h-4 w-4 text-slate-500" />
        <h2 className="text-sm font-black text-slate-900">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function MetricCard({ title, value, icon }: { title: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between text-slate-500">
        <span className="text-xs">{title}</span>
        <span>{icon}</span>
      </div>
      <div className="mt-2 text-xl font-black text-slate-900">
        {typeof value === 'number' ? value.toLocaleString('ar-EG') : value}
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-600">
      {label}
      {required && <span className="text-red-500"> *</span>}
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  optionLabels,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  optionLabels?: Record<string, string>;
  required?: boolean;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-600">
      {label}
      {required && <span className="text-red-500"> *</span>}
      <select
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500"
      >
        {!required && !options.includes('') && <option value="">اختر...</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabels?.[option] || option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActionButton({
  label,
  onClick,
  danger = false,
  busy = false,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`rounded-lg border px-2 py-1 text-xs font-semibold ${
        danger
          ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
      } disabled:opacity-60`}
      type="button"
    >
      {label}
    </button>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number | null | undefined>> }) {
  return (
    <div className="overflow-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 text-right">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={`${index}-${cellIndex}`} className="px-3 py-2 text-slate-700">
                  {cell ?? '—'}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={headers.length} className="px-3 py-8 text-center text-slate-400">لا توجد بيانات.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatMoney(value: number) {
  return `${value.toLocaleString('ar-EG')} ج.م`;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ar-EG');
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ar-EG');
}

function badgeClassForStatus(status: string) {
  if (['active', 'paid', 'success'].includes(status)) return 'bg-emerald-50 text-emerald-700';
  if (['trial', 'pending', 'processing'].includes(status)) return 'bg-sky-50 text-sky-700';
  if (['suspended', 'deleted', 'cancelled', 'expired'].includes(status)) return 'bg-red-50 text-red-700';
  return 'bg-slate-100 text-slate-700';
}
