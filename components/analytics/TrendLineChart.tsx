'use client';

import React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { fmtMoney } from '@/components/invoices/InvoiceConfig';

type Series = {
  key: string;
  name: string;
  color: string;
  format?: 'money' | 'number';
};

export function TrendLineChart({
  data,
  series,
  height = 260,
}: {
  data: Array<Record<string, any>>;
  series: Series[];
  height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#64748b" />
          <YAxis tick={{ fontSize: 11 }} stroke="#64748b" />
          <Tooltip content={<Tip series={series} />} />
          <Legend />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Tip({ active, payload, label, series }: any) {
  if (!active || !payload?.length) return null;
  const map = new Map(series.map((s: Series) => [s.key, s]));
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm" dir="rtl">
      <div className="font-bold text-slate-900 mb-1">{label}</div>
      <div className="space-y-1">
        {payload.map((p: any) => {
          const meta = map.get(p.dataKey) as Series | undefined;
          const format = meta?.format || 'number';
          const val = Number(p.value || 0);
          return (
            <div key={p.dataKey} className="flex items-center justify-between gap-6">
              <span className="text-slate-600">{meta?.name || p.name}</span>
              <span className="font-semibold text-slate-900 tabular-nums">
                {format === 'money' ? fmtMoney(val) : val.toLocaleString('ar-EG')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

