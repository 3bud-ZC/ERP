export function printHtmlReport(params: {
  title: string;
  companyName?: string;
  subtitle?: string;
  periodLabel?: string;
  htmlBody: string;
}) {
  const {
    title,
    companyName = 'OG ERP',
    subtitle,
    periodLabel,
    htmlBody,
  } = params;

  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) {
    window.print();
    return;
  }

  const html = `<!doctype html>
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
      ${htmlBody}
    </body>
  </html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.close();
  }, 300);
}

export function exportTablesAsExcel(
  title: string,
  tableHtmlCollection: string[],
) {
  if (!tableHtmlCollection.length) return;
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /></head><body>${tableHtmlCollection.join('<br/>')}</body></html>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[\\/:*?"<>|]/g, '-')}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportRowsAsCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
