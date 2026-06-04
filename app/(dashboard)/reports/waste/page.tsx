'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiGetList } from '@/lib/api/fetcher';
import { ReportsLayout } from '@/components/reports/ReportsLayout';
import {
  ReportShell,
  ReportLabel,
  ReportSummaryCard,
  reportInputCls,
} from '@/components/reports/ReportShell';

interface ProductLite {
  id: string;
  code: string;
  nameAr: string;
}

interface WasteReportRow {
  id: string;
  date: string;
  productId: string;
  productName: string;
  productCode: string;
  unit: string;
  quantity: number;
  source: 'production' | 'inventory';
  sourceLabel: string;
  reference: string;
  notes: string;
}

interface WasteByProduct {
  productId: string;
  productName: string;
  productCode: string;
  unit: string;
  totalQuantity: number;
  productionQuantity: number;
  inventoryQuantity: number;
  recordCount: number;
}

interface WasteReportResponse {
  rows: WasteReportRow[];
  summary: {
    recordCount: number;
    totalWaste: number;
    productionWaste: number;
    inventoryWaste: number;
  };
  byProduct: WasteByProduct[];
}

const SOURCE_LABELS = {
  all: 'الكل',
  production: 'أوامر الإنتاج',
  inventory: 'تسويات المخزون',
} as const;

const today = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

export default function WasteReportPage() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [productId, setProductId] = useState('all');
  const [source, setSource] = useState<'all' | 'production' | 'inventory'>('all');

  const productsQ = useQuery({
    queryKey: ['products', 'waste-report'],
    queryFn: () => apiGetList<ProductLite>('/api/products'),
    staleTime: 60_000,
  });

  const reportQ = useQuery({
    queryKey: ['reports', 'waste', from, to, productId, source],
    queryFn: () => {
      const query = new URLSearchParams({
        fromDate: from,
        toDate: to,
        source,
      });
      if (productId !== 'all') query.set('productId', productId);
      return apiGet<WasteReportResponse>(`/api/reports/waste?${query.toString()}`);
    },
    staleTime: 30_000,
  });

  const products = useMemo(() => productsQ.data ?? [], [productsQ.data]);
  const rows = reportQ.data?.rows ?? [];
  const summary = reportQ.data?.summary ?? {
    recordCount: 0,
    totalWaste: 0,
    productionWaste: 0,
    inventoryWaste: 0,
  };
  const byProduct = reportQ.data?.byProduct ?? [];

  const periodLabel = `من ${new Date(from).toLocaleDateString('ar-EG')} إلى ${new Date(to).toLocaleDateString('ar-EG')}`;
  const error = reportQ.error ? (reportQ.error as Error).message : productsQ.error ? (productsQ.error as Error).message : null;

  return (
    <ReportsLayout title="تقرير الفاقد" subtitle="فاقد أوامر الإنتاج وتسويات المخزون في شاشة واحدة">
      <ReportShell
        title="تقرير الفاقد"
        subtitle={`مصدر التقرير: ${SOURCE_LABELS[source]}`}
        periodLabel={periodLabel}
        exportConfig={{
          report: 'waste',
          params: {
            fromDate: from,
            toDate: to,
            source,
            productId: productId === 'all' ? undefined : productId,
          },
        }}
        loading={reportQ.isLoading || productsQ.isLoading}
        error={error}
        filters={
          <>
            <div>
              <ReportLabel>من تاريخ</ReportLabel>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={reportInputCls} />
            </div>
            <div>
              <ReportLabel>إلى تاريخ</ReportLabel>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className={reportInputCls} />
            </div>
            <div>
              <ReportLabel>المصدر</ReportLabel>
              <select value={source} onChange={e => setSource(e.target.value as typeof source)} className={reportInputCls}>
                <option value="all">الكل</option>
                <option value="production">أوامر الإنتاج</option>
                <option value="inventory">تسويات المخزون</option>
              </select>
            </div>
            <div>
              <ReportLabel>المنتج</ReportLabel>
              <select value={productId} onChange={e => setProductId(e.target.value)} className={reportInputCls}>
                <option value="all">كل المنتجات</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.nameAr} ({product.code})
                  </option>
                ))}
              </select>
            </div>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <ReportSummaryCard label="إجمالي سجلات الفاقد" value={summary.recordCount.toLocaleString('ar-EG')} />
          <ReportSummaryCard label="إجمالي الفاقد" value={summary.totalWaste.toLocaleString('ar-EG')} accent="bg-red-50 border-red-200" />
          <ReportSummaryCard label="فاقد أوامر الإنتاج" value={summary.productionWaste.toLocaleString('ar-EG')} accent="bg-amber-50 border-amber-200" />
          <ReportSummaryCard label="فاقد تسوية المخزون" value={summary.inventoryWaste.toLocaleString('ar-EG')} accent="bg-slate-50 border-slate-200" />
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-700">ملخص حسب المنتج</h3>
            <div className="text-xs text-slate-400">{byProduct.length.toLocaleString('ar-EG')} منتج</div>
          </div>
          {byProduct.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">لا توجد بيانات فاقد في هذه الفترة</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">المنتج</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">إجمالي الفاقد</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">فاقد الإنتاج</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">فاقد التسويات</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">عدد السجلات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {byProduct.map((item) => (
                  <tr key={item.productId} className="hover:bg-slate-50">
                    <td className="px-4 py-2 text-slate-800">
                      <div className="font-medium">{item.productName}</div>
                      <div className="text-xs text-slate-400 font-mono">{item.productCode}</div>
                    </td>
                    <td className="px-4 py-2 text-left tabular-nums font-semibold text-red-600">
                      {item.totalQuantity.toLocaleString('ar-EG')} {item.unit}
                    </td>
                    <td className="px-4 py-2 text-left tabular-nums">
                      {item.productionQuantity.toLocaleString('ar-EG')} {item.unit}
                    </td>
                    <td className="px-4 py-2 text-left tabular-nums">
                      {item.inventoryQuantity.toLocaleString('ar-EG')} {item.unit}
                    </td>
                    <td className="px-4 py-2 text-left tabular-nums">{item.recordCount.toLocaleString('ar-EG')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-700">تفاصيل السجلات</h3>
            <div className="text-xs text-slate-400">{rows.length.toLocaleString('ar-EG')} سجل</div>
          </div>
          {rows.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">لا توجد سجلات فاقد مطابقة للفلاتر الحالية</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">التاريخ</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">المنتج</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">المصدر</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">المرجع</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">الكمية</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">ملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 text-slate-500">{new Date(row.date).toLocaleDateString('ar-EG')}</td>
                    <td className="px-4 py-2 text-slate-800">
                      <div className="font-medium">{row.productName}</div>
                      <div className="text-xs text-slate-400 font-mono">{row.productCode}</div>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium border ${
                        row.source === 'production'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-slate-50 text-slate-700 border-slate-200'
                      }`}>
                        {row.sourceLabel}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-700">{row.reference || '—'}</td>
                    <td className="px-4 py-2 text-left tabular-nums font-semibold text-red-600">
                      -{row.quantity.toLocaleString('ar-EG')} {row.unit}
                    </td>
                    <td className="px-4 py-2 text-slate-500">{row.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </ReportShell>
    </ReportsLayout>
  );
}
