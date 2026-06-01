'use client';

import React from 'react';
import { Printer, Loader2, AlertCircle, FileSpreadsheet, FileDown, RefreshCw } from 'lucide-react';
import { ApiError } from '@/lib/api/fetcher';
import { useRouter } from 'next/navigation';

/**
 * Wraps a single report with: filters bar (no-print) + print button (no-print)
 * + a printable header (only visible when printing) + the result content.
 *
 * Usage:
 *
 *   <ReportShell
 *     title="تقرير المبيعات"
 *     subtitle="..."
 *     filters={<>...</>}
 *     loading={loadingFlag}
 *     error={errMsg}
 *     periodLabel="من 2026-01-01 إلى 2026-01-31"
 *   >
 *     <Table />
 *   </ReportShell>
 */
export function ReportShell({
  title,
  subtitle,
  filters,
  periodLabel,
  loading,
  error,
  children,
  extraActions,
  companyName = 'تقرير',
  exportConfig,
}: {
  title:        string;
  subtitle?:    string;
  filters?:     React.ReactNode;
  periodLabel?: string;
  loading?:     boolean;
  error?:       string | null;
  children:     React.ReactNode;
  extraActions?: React.ReactNode;
  companyName?: string;
  exportConfig?: {
    report: string;
    params?: Record<string, string | number | boolean | null | undefined>;
    enabled?: boolean;
  };
}) {
  const reportRef = React.useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [exporting, setExporting] = React.useState<'xlsx' | 'pdf' | null>(null);
  const exportEnabled = exportConfig?.enabled !== false;

  const buildExportUrl = React.useCallback((format: 'xlsx' | 'pdf') => {
    if (!exportConfig?.report) return null;
    const query = new URLSearchParams();
    query.set('report', exportConfig.report);
    query.set('format', format);
    Object.entries(exportConfig.params ?? {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      query.set(key, String(value));
    });
    return `/api/reports/export?${query.toString()}`;
  }, [exportConfig]);

  async function exportStructured(format: 'xlsx' | 'pdf') {
    const url = buildExportUrl(format);
    if (!url) return;
    setExporting(format);
    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        const errorBody = await res.json().catch(() => null);
        const message = errorBody?.error || errorBody?.message || 'تعذر تصدير التقرير';
        throw new ApiError(message, res.status);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') || '';
      const fromHeader = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/);
      const fallbackName = `${title.replace(/[\\/:*?"<>|]/g, '-')}.${format === 'xlsx' ? 'xlsx' : 'pdf'}`;
      const filename = decodeURIComponent(fromHeader?.[1] || fromHeader?.[2] || fallbackName);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (error: any) {
      alert(error?.message || 'تعذر تصدير التقرير حالياً');
    } finally {
      setExporting(null);
    }
  }

  const buildPrintableHtml = React.useCallback(() => {
    const reportHtml = reportRef.current?.innerHTML ?? '';
    return `<!doctype html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="utf-8" />
          <title>${title}</title>
          <style>
            @page { margin: 12mm; }
            body { font-family: Arial, Tahoma, sans-serif; color: #0f172a; direction: rtl; }
            .print-only-header { border-bottom: 2px solid #cbd5e1; padding-bottom: 10px; margin-bottom: 16px; display: flex; justify-content: space-between; gap: 16px; }
            .muted { color: #64748b; font-size: 12px; }
            h1 { font-size: 20px; margin: 4px 0; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #e2e8f0; padding: 7px 8px; text-align: right; }
            th { background: #f1f5f9; font-weight: 700; }
            .no-print, button, input, select, textarea { display: none !important; }
            * { box-shadow: none !important; }
          </style>
        </head>
        <body>
          <div class="print-only-header">
            <div>
              <div class="muted">${companyName}</div>
              <h1>${title}</h1>
              ${subtitle ? `<div class="muted">${subtitle}</div>` : ''}
            </div>
            <div class="muted">
              ${periodLabel ? `<div>${periodLabel}</div>` : ''}
              <div>تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG')}</div>
            </div>
          </div>
          ${reportHtml}
        </body>
      </html>`;
  }, [companyName, periodLabel, subtitle, title]);

  function printReport() {
    const win = window.open('', '_blank', 'width=1100,height=800');
    if (!win) {
      window.print();
      return;
    }
    win.document.open();
    win.document.write(buildPrintableHtml());
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
      win.close();
    }, 300);
  }

  function exportExcelLegacy() {
    const tables = reportRef.current?.querySelectorAll('table');
    if (!tables || tables.length === 0) return;
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /></head><body>${Array.from(tables).map(t => t.outerHTML).join('<br/>')}</body></html>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[\\/:*?"<>|]/g, '-')}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPdfLegacy() {
    printReport();
  }

  return (
    <div className="space-y-5">
      {/* Print-only header */}
      <div className="hidden print:block border-b-2 border-slate-300 pb-3 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">{companyName}</div>
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            {subtitle && <div className="text-xs text-slate-600 mt-0.5">{subtitle}</div>}
          </div>
          <div className="text-xs text-slate-500 text-left">
            {periodLabel && <div>{periodLabel}</div>}
            <div>تاريخ الطباعة: {new Date().toLocaleDateString('ar-EG')}</div>
          </div>
        </div>
      </div>

      {/* Filters bar */}
      {filters && (
        <div className="neo-raised rounded-2xl p-4 no-print">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3 flex-1">{filters}</div>
            <div className="flex items-center gap-2">
              {extraActions}
              <button
                type="button"
                onClick={() => router.refresh()}
                className="flex items-center gap-2 px-3 py-2 neo-raised text-slate-700 rounded-lg hover:text-indigo-700 active:scale-[0.99] transition-all text-sm font-medium"
              >
                <RefreshCw className="w-4 h-4" /> تحديث
              </button>
              <button
                type="button"
                onClick={() => exportEnabled ? exportStructured('xlsx') : undefined}
                disabled={exporting !== null || !exportEnabled}
                className="flex items-center gap-2 px-3 py-2 neo-raised text-slate-700 rounded-lg hover:text-indigo-700 active:scale-[0.99] transition-all text-sm font-medium"
              >
                {exporting === 'xlsx' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />} Excel
              </button>
              <button
                type="button"
                onClick={() => exportEnabled ? exportStructured('pdf') : undefined}
                disabled={exporting !== null || !exportEnabled}
                className="flex items-center gap-2 px-3 py-2 neo-raised text-slate-700 rounded-lg hover:text-indigo-700 active:scale-[0.99] transition-all text-sm font-medium"
              >
                {exporting === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} PDF
              </button>
              <button
                type="button"
                onClick={printReport}
                className="flex items-center gap-2 px-3 py-2 neo-raised text-indigo-700 rounded-lg hover:text-indigo-800 active:scale-[0.99] transition-all text-sm font-medium"
              >
                <Printer className="w-4 h-4" /> طباعة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error / loading */}
      {error && (
        <div className="flex items-center gap-2 text-red-700 text-sm bg-red-50 border border-red-200 rounded-[10px] px-4 py-3 no-print">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="neo-raised rounded-2xl p-12 text-center text-slate-500">
          <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin text-indigo-500" />
          جاري تحميل التقرير…
        </div>
      ) : (
        <div ref={reportRef} className="space-y-4">{children}</div>
      )}
    </div>
  );
}

/* ─── Common helpers used by every report ─── */

export function ReportLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-slate-700 mb-1.5">{children}</label>;
}

export const reportInputCls =
  'w-full neo-inset rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-4 focus:ring-indigo-500/20 min-w-[140px]';

export function fmtMoneyEGP(v?: number | null): string {
  if (v == null) return '—';
  return v.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';
}

export function ReportSummaryCard({
  label, value, accent,
}: {
  label: string; value: string | number; accent?: string;
}) {
  return (
    <div className={`rounded-2xl p-4 neo-raised ${accent ?? ''}`}>
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-xl font-bold text-slate-900 tabular-nums">{value}</div>
    </div>
  );
}
