'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '@/lib/api/fetcher';
import { queryKeys } from '@/lib/api/query-keys';
import {
  Plus,
  AlertTriangle,
  X,
  Pencil,
  Trash2,
  Search,
  Package,
  DollarSign,
  TrendingUp,
  Factory,
  Truck,
} from 'lucide-react';
import Link from 'next/link';
import { TableSkeleton, EmptyState, ErrorBanner, Toast, useToast } from '@/components/ui/patterns';
import { InventoryLayout } from '@/components/inventory/InventoryLayout';
import { KpiCard } from '@/components/accounting/AccountingLayout';

interface Product {
  id: string;
  code: string;
  nameAr: string;
  nameEn?: string;
  type?: string;
  unit?: string;
  stock: number;
  minStock?: number;
  cost: number;
  price: number;
  warehouseId?: string | null;
}

interface ValuationRow {
  productId: string;
  averageCost: number;
  totalValue: number;
  quantity: number;
}

interface WarehouseLite {
  id: string;
  nameAr: string;
  code?: string;
}

export type ProductInventoryKind = 'raw_material' | 'finished_product';

const CONFIG: Record<
  ProductInventoryKind,
  {
    title: string;
    subtitle: string;
    basePath: string;
    newLabel: string;
    emptyTitle: string;
    emptyDescription: string;
    accent: 'amber' | 'blue';
  }
> = {
  raw_material: {
    title: 'المواد الخام',
    subtitle: 'مشتريات · موردون · تكلفة متوسطة · مستودعات',
    basePath: '/inventory/raw-materials',
    newLabel: 'إضافة مادة خام',
    emptyTitle: 'لا توجد مواد خام',
    emptyDescription: 'أضف مواد خام لربطها بفواتير المشتريات والتصنيع',
    accent: 'amber',
  },
  finished_product: {
    title: 'المنتجات النهائية',
    subtitle: 'مبيعات · تسعير · ربحية · أوامر الإنتاج',
    basePath: '/inventory/finished-products',
    newLabel: 'إضافة منتج نهائي',
    emptyTitle: 'لا توجد منتجات نهائية',
    emptyDescription: 'أضف منتجات نهائية للبيع وربطها بأوامر الإنتاج',
    accent: 'blue',
  },
};

function fmtEGP(v?: number | null) {
  if (v == null || Number.isNaN(v)) return '—';
  return (
    v.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
    ' ج.م'
  );
}

function marginPct(price: number, cost: number): number | null {
  if (!price || price <= 0) return null;
  return ((price - cost) / price) * 100;
}

export function ProductInventoryPage({ kind }: { kind: ProductInventoryKind }) {
  const cfg = CONFIG[kind];
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  const productsQ = useQuery({
    queryKey: queryKeys.products(kind),
    queryFn: () => apiGet<Product[]>(`/api/products?type=${kind}`),
    staleTime: 0,
  });

  const valuationQ = useQuery({
    queryKey: ['inventory-valuation', kind],
    queryFn: () =>
      apiGet<{
        valuations: ValuationRow[];
        summary?: { totalInventoryValue: number };
      }>('/api/inventory/valuation'),
    staleTime: 30_000,
  });

  const warehousesQ = useQuery({
    queryKey: queryKeys.warehouses,
    queryFn: () => apiGet<WarehouseLite[]>('/api/warehouses'),
    staleTime: 60_000,
  });

  const products = useMemo(() => productsQ.data ?? [], [productsQ.data]);
  const loading = productsQ.isLoading;
  const error = productsQ.error ? (productsQ.error as Error).message : null;

  const valuationByProduct = useMemo(() => {
    const map = new Map<string, ValuationRow>();
    for (const v of valuationQ.data?.valuations ?? []) {
      map.set(v.productId, v);
    }
    return map;
  }, [valuationQ.data]);

  const warehouseById = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of warehousesQ.data ?? []) {
      map.set(w.id, w.nameAr);
    }
    return map;
  }, [warehousesQ.data]);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const reload = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['inventory-valuation'] });
  }, [qc]);

  const filtered = useMemo(
    () =>
      products.filter(
        p =>
          !search ||
          p.nameAr.includes(search) ||
          (p.nameEn || '').toLowerCase().includes(search.toLowerCase()) ||
          p.code.toLowerCase().includes(search.toLowerCase()),
      ),
    [products, search],
  );

  const stats = useMemo(() => {
    let stockValue = 0;
    let lowStock = 0;
    let totalQty = 0;
    for (const p of products) {
      const v = valuationByProduct.get(p.id);
      const avg = v?.averageCost ?? p.cost ?? 0;
      const qty = p.stock ?? 0;
      totalQty += qty;
      stockValue += v?.totalValue ?? qty * avg;
      const threshold = p.minStock ?? 0;
      if (threshold > 0 && qty <= threshold) lowStock++;
    }
    return { count: products.length, stockValue, lowStock, totalQty };
  }, [products, valuationByProduct]);

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/products?id=${deleteId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const j = await res.json();
      if (j.success) {
        setDeleteId(null);
        reload();
        showToast('تم الحذف');
      } else setDeleteError(j.message || j.error || 'فشل الحذف');
    } catch {
      setDeleteError('تعذر الاتصال بالخادم');
    } finally {
      setDeleting(false);
    }
  }

  const kpiColor = cfg.accent === 'amber' ? 'amber' : 'blue';

  return (
    <InventoryLayout
      title={cfg.title}
      subtitle={
        <span className="inline-flex items-center gap-2 flex-wrap">
          {loading ? 'جاري التحميل…' : `${stats.count} صنف`}
          {!loading && stats.lowStock > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-600 rounded-full text-xs font-medium">
              <AlertTriangle className="w-3 h-3" /> {stats.lowStock} منخفض المخزون
            </span>
          )}
        </span>
      }
      toolbar={
        <Link
          href={`${cfg.basePath}/new`}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:scale-95 transition-all text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> {cfg.newLabel}
        </Link>
      }
    >
      <Toast toast={toast} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <KpiCard title="عدد الأصناف" value={stats.count} icon={Package} color={kpiColor} />
        <KpiCard
          title="قيمة المخزون"
          value={fmtEGP(stats.stockValue)}
          subtitle="من طبقات التكلفة"
          icon={DollarSign}
          color="green"
        />
        <KpiCard
          title="إجمالي الكميات"
          value={stats.totalQty.toLocaleString('ar-EG')}
          icon={kind === 'raw_material' ? Truck : Factory}
          color="blue"
        />
        <KpiCard
          title="تنبيهات المخزون"
          value={stats.lowStock}
          subtitle="وصلت للحد الأدنى"
          icon={AlertTriangle}
          color="red"
        />
      </div>

      <div className="relative flex-1 min-w-48 mb-5 max-w-xl">
        <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="بحث بالاسم أو الرمز…"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute left-3 top-2.5 text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {error && (
        <div className="mb-5">
          <ErrorBanner message={error} onRetry={() => productsQ.refetch()} />
        </div>
      )}

      {loading ? (
        <TableSkeleton cols={['w-16', 'w-32', 'w-16', 'w-24', 'w-24', 'w-20', 'w-16']} rows={6} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={kind === 'raw_material' ? Truck : Package}
          title={search ? 'لا توجد نتائج مطابقة للبحث' : cfg.emptyTitle}
          description={!search ? cfg.emptyDescription : undefined}
        />
      ) : kind === 'raw_material' ? (
        <RawMaterialsTable
          rows={filtered}
          valuationByProduct={valuationByProduct}
          warehouseById={warehouseById}
          basePath={cfg.basePath}
          fmtEGP={fmtEGP}
          onDelete={setDeleteId}
        />
      ) : (
        <FinishedProductsTable
          rows={filtered}
          valuationByProduct={valuationByProduct}
          basePath={cfg.basePath}
          fmtEGP={fmtEGP}
          onDelete={setDeleteId}
        />
      )}

      {deleteId && (
        <DeleteModal
          deleting={deleting}
          deleteError={deleteError}
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </InventoryLayout>
  );
}

function RawMaterialsTable({
  rows,
  valuationByProduct,
  warehouseById,
  basePath,
  fmtEGP,
  onDelete,
}: {
  rows: Product[];
  valuationByProduct: Map<string, ValuationRow>;
  warehouseById: Map<string, string>;
  basePath: string;
  fmtEGP: (v?: number | null) => string;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">الرمز</th>
            <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">الاسم</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">المخزون</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">الحد الأدنى</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">متوسط التكلفة</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">قيمة المخزون</th>
            <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">المستودع</th>
            <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500">إجراءات</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(p => {
            const v = valuationByProduct.get(p.id);
            const avg = v?.averageCost ?? p.cost;
            const value = v?.totalValue ?? p.stock * avg;
            const lowStock = p.stock <= (p.minStock ?? 0);
            return (
              <tr key={p.id} className={`hover:bg-slate-50 ${lowStock ? 'bg-red-50/30' : ''}`}>
                <td className="px-5 py-3 text-sm font-mono text-slate-500">{p.code}</td>
                <td className="px-5 py-3 text-sm font-medium text-slate-900">{p.nameAr}</td>
                <td className="px-5 py-3 text-sm font-semibold text-left tabular-nums">
                  {p.stock.toLocaleString('ar-EG')} {p.unit ?? ''}
                  {lowStock && (
                    <AlertTriangle className="w-3 h-3 inline mr-1 text-red-600" />
                  )}
                </td>
                <td className="px-5 py-3 text-sm text-slate-500 text-left tabular-nums">
                  {p.minStock != null ? p.minStock.toLocaleString('ar-EG') : '—'}
                </td>
                <td className="px-5 py-3 text-sm text-left tabular-nums">{fmtEGP(avg)}</td>
                <td className="px-5 py-3 text-sm text-left tabular-nums font-medium">
                  {fmtEGP(value)}
                </td>
                <td className="px-5 py-3 text-sm text-slate-600">
                  {p.warehouseId ? warehouseById.get(p.warehouseId) ?? '—' : '—'}
                </td>
                <td className="px-5 py-3">
                  <RowActions basePath={basePath} id={p.id} onDelete={onDelete} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FinishedProductsTable({
  rows,
  valuationByProduct,
  basePath,
  fmtEGP,
  onDelete,
}: {
  rows: Product[];
  valuationByProduct: Map<string, ValuationRow>;
  basePath: string;
  fmtEGP: (v?: number | null) => string;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">الرمز</th>
            <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">الاسم</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">المخزون</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">التكلفة</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">سعر البيع</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">هامش الربح</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">قيمة المخزون</th>
            <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500">إجراءات</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(p => {
            const v = valuationByProduct.get(p.id);
            const cost = v?.averageCost ?? p.cost;
            const margin = marginPct(p.price, cost);
            const lowStock = p.stock <= (p.minStock ?? 0);
            return (
              <tr key={p.id} className={`hover:bg-slate-50 ${lowStock ? 'bg-red-50/30' : ''}`}>
                <td className="px-5 py-3 text-sm font-mono text-slate-500">{p.code}</td>
                <td className="px-5 py-3 text-sm font-medium text-slate-900">
                  {p.nameAr}
                  <Link
                    href={`/manufacturing/production-orders?productId=${p.id}`}
                    className="block text-xs text-indigo-600 hover:underline mt-0.5"
                  >
                    أوامر الإنتاج
                  </Link>
                </td>
                <td className="px-5 py-3 text-sm font-semibold text-left tabular-nums">
                  {p.stock.toLocaleString('ar-EG')}
                </td>
                <td className="px-5 py-3 text-sm text-left tabular-nums">{fmtEGP(cost)}</td>
                <td className="px-5 py-3 text-sm font-medium text-left tabular-nums">
                  {fmtEGP(p.price)}
                </td>
                <td className="px-5 py-3 text-sm text-left">
                  {margin != null ? (
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        margin >= 20
                          ? 'text-green-700'
                          : margin >= 0
                            ? 'text-amber-700'
                            : 'text-red-600'
                      }`}
                    >
                      <TrendingUp className="w-3.5 h-3.5" />
                      {margin.toFixed(1)}%
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-5 py-3 text-sm text-left tabular-nums">
                  {fmtEGP(v?.totalValue ?? p.stock * cost)}
                </td>
                <td className="px-5 py-3">
                  <RowActions basePath={basePath} id={p.id} onDelete={onDelete} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RowActions({
  basePath,
  id,
  onDelete,
}: {
  basePath: string;
  id: string;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      <Link
        href={`${basePath}/${id}/edit`}
        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
        title="تعديل"
      >
        <Pencil className="w-4 h-4" />
      </Link>
      <button
        type="button"
        onClick={() => onDelete(id)}
        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        title="حذف"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function DeleteModal({
  deleting,
  deleteError,
  onConfirm,
  onCancel,
}: {
  deleting: boolean;
  deleteError: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      dir="rtl"
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center">
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Trash2 className="w-6 h-6 text-red-600" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900 mb-2">تأكيد الحذف</h3>
        <p className="text-sm text-slate-500 mb-3">
          هل أنت متأكد؟ لا يمكن حذف صنف مرتبط بفواتير أو أوامر.
        </p>
        {deleteError && (
          <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
            {deleteError}
          </p>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? 'جاري الحذف…' : 'حذف'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 bg-slate-100 text-slate-700 rounded-lg py-2 text-sm font-medium hover:bg-slate-200"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
