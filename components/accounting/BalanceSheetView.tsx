'use client';

import { Banknote, Landmark, Scale, Wallet } from 'lucide-react';
import { KpiCard } from '@/components/accounting/AccountingLayout';
import { fmtMoneyEGP } from '@/components/reports/ReportShell';
import type { BalanceSheetData, BalanceSheetSection, BalanceSheetRow } from '@/lib/reports/balance-sheet';

export function BalanceSheetView({ data }: { data: BalanceSheetData }) {
  return (
    <div className="space-y-5" dir="rtl">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="إجمالي الأصول" value={fmtMoneyEGP(data.summary.totalAssets)} subtitle="الأصول الثابتة والمتداولة" icon={Wallet} color="green" />
        <KpiCard title="إجمالي الالتزامات" value={fmtMoneyEGP(data.summary.totalLiabilities)} subtitle="الموردون والديون والاستحقاقات" icon={Landmark} color="amber" />
        <KpiCard title="صافي المركز المالي" value={fmtMoneyEGP(data.summary.netFinancialPosition)} subtitle="الأصول ناقص الالتزامات" icon={Scale} color="blue" />
        <KpiCard title="إجمالي الخزنة / النقدية" value={fmtMoneyEGP(data.summary.treasuryCash)} subtitle="الخزائن النشطة فقط" icon={Banknote} color="slate" />
      </div>

      <BalanceSummaryBar data={data} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <BalanceSectionCard section={data.sections.fixedAssets} />
        <BalanceSectionCard section={data.sections.treasury} />
        <BalanceSectionCard section={data.sections.currentAssets} />
        <BalanceSectionCard section={data.sections.inventory} />
        <BalanceSectionCard section={data.sections.customers} />
        <BalanceSectionCard section={data.sections.suppliers} />
        <BalanceSectionCard section={data.sections.expenses} />
        <BalanceSectionCard section={data.sections.liabilities} />
        <div className="xl:col-span-2">
          <BalanceSectionCard section={data.sections.equity} />
        </div>
      </div>
    </div>
  );
}

function BalanceSummaryBar({ data }: { data: BalanceSheetData }) {
  return (
    <div className={`rounded-xl border p-4 text-sm ${data.summary.isBalanced ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-900">إجمالي الخصوم + حقوق الملكية</div>
          <div className="text-xs text-slate-500">
            {data.summary.isBalanced ? 'الميزانية متوازنة' : 'الميزانية غير متوازنة'}
          </div>
        </div>
        <div className="text-left">
          <div className="text-base font-bold tabular-nums text-slate-900">{fmtMoneyEGP(data.summary.totalLiabilitiesAndEquity)}</div>
          {!data.summary.isBalanced && <div className="text-xs text-red-700">الفرق: {fmtMoneyEGP(data.summary.difference)}</div>}
        </div>
      </div>
    </div>
  );
}

function BalanceSectionCard({ section }: { section: BalanceSheetSection }) {
  return (
    <section className="break-inside-avoid overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" dir="rtl">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{section.title}</h3>
            {section.note && <p className="mt-1 text-xs leading-5 text-slate-500">{section.note}</p>}
          </div>
          <div className="text-left">
            <div className="text-xs text-slate-500">إجمالي القسم</div>
            <div className="text-lg font-bold tabular-nums text-slate-900">{fmtMoneyEGP(section.total)}</div>
          </div>
        </div>
      </div>

      {section.rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-5 py-3 text-right font-medium">البند</th>
                <th className="px-3 py-3 text-right font-medium">المصدر</th>
                <th className="px-3 py-3 text-right font-medium">النوع</th>
                <th className="px-5 py-3 text-left font-medium">القيمة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {section.rows.map((row) => (
                <tr key={row.key} className="hover:bg-slate-50">
                  <td className="px-5 py-3 align-top">
                    <div className="font-medium text-slate-900">{row.label}</div>
                    {row.note && <div className="mt-1 text-xs leading-5 text-slate-500">{row.note}</div>}
                  </td>
                  <td className="px-3 py-3 align-top text-xs text-slate-500">{row.source}</td>
                  <td className="px-3 py-3 align-top text-xs">
                    <span className={`inline-flex rounded-full px-2 py-1 font-medium ${
                      row.classification === 'asset'
                        ? 'bg-emerald-50 text-emerald-700'
                        : row.classification === 'liability'
                          ? 'bg-amber-50 text-amber-700'
                          : row.classification === 'equity'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-slate-100 text-slate-600'
                    }`}>
                      {classificationLabel(row.classification)}
                    </span>
                  </td>
                  <td className={`px-5 py-3 text-left tabular-nums font-semibold ${
                    row.classification === 'asset'
                      ? 'text-emerald-700'
                      : row.classification === 'liability'
                        ? 'text-amber-700'
                        : row.classification === 'equity'
                          ? 'text-blue-700'
                          : 'text-slate-900'
                  }`}>
                    {fmtMoneyEGP(row.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-6 text-center text-sm text-slate-400">لا توجد بنود</div>
      )}
    </section>
  );
}

function classificationLabel(classification: BalanceSheetRow['classification']) {
  switch (classification) {
    case 'asset':
      return 'أصل';
    case 'liability':
      return 'التزام';
    case 'equity':
      return 'حقوق ملكية';
    default:
      return 'توضيح';
  }
}
