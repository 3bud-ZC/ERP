import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/db';
import { apiError, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';
import { hasReportAccess, type ReportKey } from '@/lib/reports/report-access';
import { buildWasteReportData, type WasteReportSource } from '@/lib/reports/waste-report';
import { buildBalanceSheetData } from '@/lib/reports/balance-sheet';
import { openingNet } from '@/lib/services/party-debt.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ReportDataset = {
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
};

const REPORT_KEYS = new Set<ReportKey>([
  'sales',
  'purchases',
  'inventory',
  'waste',
  'expenses',
  'customer-statement',
  'supplier-statement',
  'receivables',
  'payables',
  'profit-loss',
  'balance-sheet',
  'cashbox-print',
  'manufacturing',
]);

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const { searchParams } = new URL(request.url);
    const report = (searchParams.get('report') || '').trim() as ReportKey;
    const format = (searchParams.get('format') || '').trim().toLowerCase();
    if (!REPORT_KEYS.has(report)) return apiError('نوع التقرير غير مدعوم', 400);
    if (format !== 'xlsx' && format !== 'pdf') return apiError('صيغة التصدير غير مدعومة', 400);
    if (!hasReportAccess(user, report)) return apiError('ليس لديك صلاحية للوصول إلى هذا التقرير', 403);

    const dataset = await buildDataset(report, user.tenantId, searchParams);
    if (format === 'xlsx') {
      return xlsxResponse(dataset);
    }
    return await pdfResponse(dataset);
  } catch (error) {
    return handleApiError(error, 'Export report');
  }
}

async function buildDataset(report: ReportKey, tenantId: string, params: URLSearchParams): Promise<ReportDataset> {
  switch (report) {
    case 'sales':
      return buildSalesDataset(tenantId, params);
    case 'purchases':
      return buildPurchasesDataset(tenantId, params);
    case 'inventory':
      return buildInventoryDataset(tenantId, params);
    case 'waste':
      return buildWasteDataset(tenantId, params);
    case 'expenses':
      return buildExpensesDataset(tenantId, params);
    case 'customer-statement':
      return buildCustomerStatementDataset(tenantId, params);
    case 'supplier-statement':
      return buildSupplierStatementDataset(tenantId, params);
    case 'receivables':
      return buildReceivablesDataset(tenantId, params);
    case 'payables':
      return buildPayablesDataset(tenantId, params);
    case 'profit-loss':
      return buildProfitLossDataset(tenantId, params);
    case 'balance-sheet':
      return buildBalanceSheetDataset(tenantId, params);
    case 'cashbox-print':
      return buildCashboxPrintDataset(tenantId, params);
    case 'manufacturing':
      return buildManufacturingDataset(tenantId, params);
    default:
      return { title: 'تقرير', columns: ['البيان'], rows: [] };
  }
}

async function buildSalesDataset(tenantId: string, params: URLSearchParams): Promise<ReportDataset> {
  const where: any = {
    tenantId,
    date: {
      gte: parseDate(params.get('fromDate')),
      lte: endOfDay(parseDate(params.get('toDate'))),
    },
  };
  const customerId = params.get('customerId');
  const status = params.get('status');
  if (customerId) where.customerId = customerId;
  if (status && status !== 'all') where.paymentStatus = status;

  const invoices = await prisma.salesInvoice.findMany({
    where,
    select: {
      invoiceNumber: true,
      date: true,
      total: true,
      grandTotal: true,
      paidAmount: true,
      paymentStatus: true,
      customer: { select: { code: true, nameAr: true } },
    },
    orderBy: { date: 'desc' },
  });

  return {
    title: 'تقرير المبيعات',
    columns: ['رقم الفاتورة', 'التاريخ', 'العميل', 'الإجمالي', 'المدفوع', 'المتبقي', 'الحالة'],
    rows: invoices.map((inv) => {
      const total = Number(inv.grandTotal || inv.total || 0);
      const paid = Number(inv.paidAmount || 0);
      return [
        inv.invoiceNumber,
        toArDate(inv.date),
        `${inv.customer?.nameAr || '-'} (${inv.customer?.code || '-'})`,
        total,
        paid,
        Math.max(0, total - paid),
        inv.paymentStatus || '—',
      ];
    }),
  };
}

async function buildPurchasesDataset(tenantId: string, params: URLSearchParams): Promise<ReportDataset> {
  const where: any = {
    tenantId,
    date: {
      gte: parseDate(params.get('fromDate')),
      lte: endOfDay(parseDate(params.get('toDate'))),
    },
  };
  const supplierId = params.get('supplierId');
  const status = params.get('status');
  if (supplierId) where.supplierId = supplierId;
  if (status && status !== 'all') where.paymentStatus = status;

  const invoices = await prisma.purchaseInvoice.findMany({
    where,
    select: {
      invoiceNumber: true,
      date: true,
      total: true,
      grandTotal: true,
      paidAmount: true,
      paymentStatus: true,
      supplier: { select: { code: true, nameAr: true } },
    },
    orderBy: { date: 'desc' },
  });

  return {
    title: 'تقرير المشتريات',
    columns: ['رقم الفاتورة', 'التاريخ', 'المورد', 'الإجمالي', 'المدفوع', 'المتبقي', 'الحالة'],
    rows: invoices.map((inv) => {
      const total = Number(inv.grandTotal || inv.total || 0);
      const paid = Number(inv.paidAmount || 0);
      return [
        inv.invoiceNumber,
        toArDate(inv.date),
        `${inv.supplier?.nameAr || '-'} (${inv.supplier?.code || '-'})`,
        total,
        paid,
        Math.max(0, total - paid),
        inv.paymentStatus || '—',
      ];
    }),
  };
}

async function buildInventoryDataset(tenantId: string, params: URLSearchParams): Promise<ReportDataset> {
  const status = params.get('status');
  const type = params.get('type');
  const products = await prisma.product.findMany({
    where: {
      tenantId,
      ...(type && type !== 'all' && { type }),
      isActive: true,
    },
    select: {
      code: true,
      nameAr: true,
      type: true,
      stock: true,
      minStock: true,
      cost: true,
      price: true,
      unit: true,
    },
    orderBy: { nameAr: 'asc' },
  });

  const filtered = products.filter((product) => {
    const min = Number(product.minStock || 0);
    const stock = Number(product.stock || 0);
    if (status === 'low') return stock > 0 && stock <= min;
    if (status === 'out') return stock === 0;
    return true;
  });

  return {
    title: 'تقرير المخازن',
    columns: ['الكود', 'الاسم', 'النوع', 'الرصيد', 'الحد الأدنى', 'التكلفة', 'سعر البيع', 'قيمة المخزون'],
    rows: filtered.map((product) => {
      const stock = Number(product.stock || 0);
      const cost = Number(product.cost || 0);
      return [
        product.code,
        product.nameAr,
        product.type === 'raw_material' ? 'مواد خام' : 'منتج نهائي',
        `${stock} ${product.unit || ''}`.trim(),
        Number(product.minStock || 0),
        cost,
        Number(product.price || 0),
        stock * cost,
      ];
    }),
  };
}

async function buildExpensesDataset(tenantId: string, params: URLSearchParams): Promise<ReportDataset> {
  const fromDate = parseDate(params.get('fromDate'));
  const toDate = endOfDay(parseDate(params.get('toDate')));
  const category = params.get('category');
  const expenses = await prisma.expense.findMany({
    where: {
      tenantId,
      date: { gte: fromDate, lte: toDate },
      ...(category ? { category } : {}),
    },
    select: {
      date: true,
      category: true,
      amount: true,
      description: true,
      cashboxId: true,
      cashbox: { select: { name: true } },
    },
    orderBy: { date: 'desc' },
  });

  return {
    title: 'تقرير المصروفات',
    columns: ['التاريخ', 'التصنيف', 'طريقة الدفع', 'المبلغ', 'الوصف'],
    rows: expenses.map((expense) => [
      toArDate(expense.date),
      expense.category || '-',
      expense.cashbox ? `خزنة - ${expense.cashbox.name}` : (expense.cashboxId ? 'مرتبط بخزنة' : 'غير محدد'),
      Number(expense.amount || 0),
      expense.description || '-',
    ]),
  };
}

async function buildWasteDataset(tenantId: string, params: URLSearchParams): Promise<ReportDataset> {
  const source = (params.get('source') || 'all') as WasteReportSource;
  const data = await buildWasteReportData({
    tenantId,
    fromDate: parseDate(params.get('fromDate')),
    toDate: endOfDay(parseDate(params.get('toDate'))),
    productId: params.get('productId') || undefined,
    source,
  });

  return {
    title: 'تقرير الفاقد',
    columns: ['التاريخ', 'المنتج', 'المصدر', 'المرجع', 'الكمية', 'الوحدة', 'ملاحظات'],
    rows: data.rows.map((row) => [
      toArDate(row.date),
      `${row.productName} (${row.productCode})`,
      row.sourceLabel,
      row.reference || '—',
      row.quantity,
      row.unit || '',
      row.notes || '—',
    ]),
  };
}

async function buildCustomerStatementDataset(tenantId: string, params: URLSearchParams): Promise<ReportDataset> {
  const customerId = params.get('customerId');
  if (!customerId) return { title: 'كشف حساب عميل', columns: ['ملاحظة'], rows: [['اختر عميلًا أولاً']] };
  const fromDate = parseDate(params.get('fromDate'));
  const toDate = endOfDay(parseDate(params.get('toDate')));

  const customer = await prisma.customer.findFirst({
    where: { tenantId, id: customerId },
    select: { nameAr: true, code: true },
  });
  if (!customer) return { title: 'كشف حساب عميل', columns: ['ملاحظة'], rows: [['العميل غير موجود']] };

  const invoices = await prisma.salesInvoice.findMany({
    where: { tenantId, customerId, date: { gte: fromDate, lte: toDate } },
    select: { date: true, invoiceNumber: true, grandTotal: true, total: true },
    orderBy: { date: 'asc' },
  });
  const payments = await prisma.payment.findMany({
    where: { tenantId, customerId, date: { gte: fromDate, lte: toDate } },
    select: { date: true, amount: true, id: true },
    orderBy: { date: 'asc' },
  });

  const entries: Array<{ date: Date; label: string; debit: number; credit: number; balance: number }> = [];
  let running = 0;
  invoices.forEach((invoice) => {
    const amount = Number(invoice.grandTotal || invoice.total || 0);
    running += amount;
    entries.push({ date: invoice.date, label: `فاتورة ${invoice.invoiceNumber}`, debit: amount, credit: 0, balance: running });
  });
  payments.forEach((payment) => {
    const amount = Number(payment.amount || 0);
    running -= amount;
    entries.push({ date: payment.date, label: `تحصيل ${payment.id}`, debit: 0, credit: amount, balance: running });
  });
  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  const rows = entries.map((entry) => [toArDate(entry.date), entry.label, entry.debit, entry.credit, entry.balance]);

  return {
    title: `كشف حساب عميل - ${customer.nameAr} (${customer.code})`,
    columns: ['التاريخ', 'البيان', 'مدين', 'دائن', 'الرصيد'],
    rows,
  };
}

async function buildSupplierStatementDataset(tenantId: string, params: URLSearchParams): Promise<ReportDataset> {
  const supplierId = params.get('supplierId');
  if (!supplierId) return { title: 'كشف حساب مورد', columns: ['ملاحظة'], rows: [['اختر موردًا أولاً']] };
  const fromDate = parseDate(params.get('fromDate'));
  const toDate = endOfDay(parseDate(params.get('toDate')));

  const supplier = await prisma.supplier.findFirst({
    where: { tenantId, id: supplierId },
    select: { nameAr: true, code: true },
  });
  if (!supplier) return { title: 'كشف حساب مورد', columns: ['ملاحظة'], rows: [['المورد غير موجود']] };

  const invoices = await prisma.purchaseInvoice.findMany({
    where: { tenantId, supplierId, date: { gte: fromDate, lte: toDate } },
    select: { date: true, invoiceNumber: true, grandTotal: true, total: true },
    orderBy: { date: 'asc' },
  });
  const payments = await prisma.payment.findMany({
    where: { tenantId, supplierId, date: { gte: fromDate, lte: toDate } },
    select: { date: true, amount: true, id: true },
    orderBy: { date: 'asc' },
  });

  const entries: Array<{ date: Date; label: string; debit: number; credit: number; balance: number }> = [];
  let running = 0;
  invoices.forEach((invoice) => {
    const amount = Number(invoice.grandTotal || invoice.total || 0);
    running += amount;
    entries.push({ date: invoice.date, label: `فاتورة ${invoice.invoiceNumber}`, debit: amount, credit: 0, balance: running });
  });
  payments.forEach((payment) => {
    const amount = Number(payment.amount || 0);
    running -= amount;
    entries.push({ date: payment.date, label: `سداد ${payment.id}`, debit: 0, credit: amount, balance: running });
  });
  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  const rows = entries.map((entry) => [toArDate(entry.date), entry.label, entry.debit, entry.credit, entry.balance]);

  return {
    title: `كشف حساب مورد - ${supplier.nameAr} (${supplier.code})`,
    columns: ['التاريخ', 'البيان', 'مدين', 'دائن', 'الرصيد'],
    rows,
  };
}

async function buildReceivablesDataset(tenantId: string, params: URLSearchParams): Promise<ReportDataset> {
  return buildOpenInvoiceDataset('sales', tenantId, params);
}

async function buildPayablesDataset(tenantId: string, params: URLSearchParams): Promise<ReportDataset> {
  return buildOpenInvoiceDataset('purchase', tenantId, params);
}

async function buildOpenInvoiceDataset(kind: 'sales' | 'purchase', tenantId: string, params: URLSearchParams): Promise<ReportDataset> {
  const paymentStatus = params.get('status');
  const fromDate = parseDate(params.get('fromDate'));
  const toDate = endOfDay(parseDate(params.get('toDate')));
  const isSales = kind === 'sales';

  const [parties, invoices, settlements] = await Promise.all([
    isSales
      ? prisma.customer.findMany({
          where: { tenantId, isActive: true },
          select: { id: true, code: true, nameAr: true, openingBalanceType: true, openingBalanceAmount: true, openingBalanceDate: true },
        })
      : prisma.supplier.findMany({
          where: { tenantId, isActive: true },
          select: { id: true, code: true, nameAr: true, openingBalanceType: true, openingBalanceAmount: true, openingBalanceDate: true },
        }),
    isSales
      ? prisma.salesInvoice.findMany({
          where: {
            tenantId,
            date: { gte: fromDate, lte: toDate },
            ...(paymentStatus && paymentStatus !== 'all' && paymentStatus !== 'open' ? { paymentStatus } : {}),
          },
          select: {
            invoiceNumber: true,
            date: true,
            total: true,
            grandTotal: true,
            paidAmount: true,
            paymentStatus: true,
            paymentTermsDays: true,
            customer: { select: { id: true, code: true, nameAr: true } },
          },
          orderBy: { date: 'desc' },
        })
      : prisma.purchaseInvoice.findMany({
          where: {
            tenantId,
            date: { gte: fromDate, lte: toDate },
            ...(paymentStatus && paymentStatus !== 'all' && paymentStatus !== 'open' ? { paymentStatus } : {}),
          },
          select: {
            invoiceNumber: true,
            date: true,
            total: true,
            grandTotal: true,
            paidAmount: true,
            paymentStatus: true,
            paymentTermsDays: true,
            supplier: { select: { id: true, code: true, nameAr: true } },
          },
          orderBy: { date: 'desc' },
        }),
    prisma.partyDebtTransaction.findMany({
      where: {
        tenantId,
        partyType: isSales ? 'customer' : 'supplier',
        transactionType: isSales ? { in: ['customer_collection', 'customer_refund'] } : { in: ['supplier_payment', 'supplier_refund'] },
        date: { gte: fromDate, lte: toDate },
      },
      select: {
        id: true,
        customerId: true,
        supplierId: true,
        transactionType: true,
        amount: true,
        date: true,
        notes: true,
      },
      orderBy: { date: 'desc' },
    }),
  ]);

  const invoiceRows = (invoices as any[])
    .map((invoice) => {
      const total = Number(invoice.grandTotal || invoice.total || 0);
      const paid = Number(invoice.paidAmount || 0);
      const remaining = Math.max(0, total - paid);
      const dueDate = new Date(invoice.date);
      dueDate.setDate(dueDate.getDate() + Number(invoice.paymentTermsDays || 0));
      const overdueDays = remaining > 0 ? Math.max(0, Math.floor((Date.now() - dueDate.getTime()) / 86400000)) : 0;
      const party = isSales ? invoice.customer : invoice.supplier;
      return [ `${party?.nameAr || '-'} (${party?.code || '-'})`, isSales ? 'فاتورة مبيعات' : 'فاتورة مشتريات', invoice.invoiceNumber, toArDate(invoice.date), toArDate(dueDate), total, paid, remaining, overdueDays ];
    })
    .filter((row) => (paymentStatus === 'open' || !paymentStatus || paymentStatus === 'all' ? Math.abs(Number(row[7])) > 0.01 : true));

  const openingRows = (parties as any[])
    .map((party) => {
      const opening = openingNet(isSales ? 'customer' : 'supplier', party.openingBalanceType, party.openingBalanceAmount);
      if (opening <= 0.01) return null;
      return [
        `${party.nameAr || '-'} (${party.code || '-'})`,
        'رصيد افتتاحي',
        'رصيد افتتاحي',
        toArDate(party.openingBalanceDate),
        toArDate(party.openingBalanceDate),
        opening,
        0,
        opening,
        0,
      ];
    })
    .filter(Boolean) as Array<Array<string | number>>;

  const settlementRows = (settlements as any[]).map((row) => {
    const party = (parties as any[]).find((item) => item.id === (isSales ? row.customerId : row.supplierId));
    const amount = Number(row.amount || 0);
    const remaining = row.transactionType === (isSales ? 'customer_collection' : 'supplier_payment') ? -amount : amount;
    return [
      `${party?.nameAr || '-'} (${party?.code || '-'})`,
      isSales ? (row.transactionType === 'customer_collection' ? 'تحصيل مباشر' : 'رصيد دائن للعميل') : (row.transactionType === 'supplier_payment' ? 'سداد مباشر' : 'تحصيل من المورد'),
      row.notes || row.transactionType,
      toArDate(row.date),
      toArDate(row.date),
      0,
      amount,
      remaining,
      0,
    ];
  });

  const rows = [...openingRows, ...invoiceRows, ...settlementRows];

  return {
    title: isSales ? 'تقرير مديونيات العملاء' : 'تقرير مستحقات الموردين',
    columns: ['الطرف', 'البيان', 'المرجع', 'التاريخ', 'الاستحقاق', 'الإجمالي', 'المدفوع', 'المتبقي', 'أيام التأخير'],
    rows,
  };
}

async function buildAgingDataset(tenantId: string, params: URLSearchParams): Promise<ReportDataset> {
  const type = params.get('type') === 'ap' ? 'ap' : 'ar';
  const asOfDate = parseDate(params.get('asOfDate')) || new Date();
  const invoices = type === 'ar'
    ? await prisma.salesInvoice.findMany({
        where: { tenantId, date: { lte: asOfDate } },
        select: { invoiceNumber: true, date: true, paymentTermsDays: true, total: true, grandTotal: true, paidAmount: true, customer: { select: { code: true, nameAr: true } } },
      })
    : await prisma.purchaseInvoice.findMany({
        where: { tenantId, date: { lte: asOfDate } },
        select: { invoiceNumber: true, date: true, paymentTermsDays: true, total: true, grandTotal: true, paidAmount: true, supplier: { select: { code: true, nameAr: true } } },
      });

  const rows = (invoices as any[])
    .map((invoice) => {
      const total = Number(invoice.grandTotal || invoice.total || 0);
      const paid = Number(invoice.paidAmount || 0);
      const remaining = Math.max(0, total - paid);
      const dueDate = new Date(invoice.date);
      dueDate.setDate(dueDate.getDate() + Number(invoice.paymentTermsDays || 0));
      const days = remaining > 0 ? Math.max(0, Math.floor((asOfDate.getTime() - dueDate.getTime()) / 86400000)) : 0;
      const bucket = days > 90 ? '90+' : days > 60 ? '61-90' : days > 30 ? '31-60' : days > 0 ? '1-30' : 'current';
      const party = type === 'ar' ? invoice.customer : invoice.supplier;
      return {
        party,
        invoiceNumber: invoice.invoiceNumber,
        remaining,
        days,
        bucket,
      };
    })
    .filter((row) => row.remaining > 0.01)
    .map((row) => [
      `${row.party?.nameAr || '-'} (${row.party?.code || '-'})`,
      row.invoiceNumber,
      row.bucket,
      row.days,
      row.remaining,
    ]);

  return {
    title: type === 'ar' ? 'تقرير أعمار الذمم المدينة' : 'تقرير أعمار الذمم الدائنة',
    columns: ['الطرف', 'رقم الفاتورة', 'فئة العمر', 'أيام التأخير', 'الرصيد'],
    rows,
  };
}

async function buildProfitLossDataset(tenantId: string, params: URLSearchParams): Promise<ReportDataset> {
  const fromDate = parseDate(params.get('fromDate'));
  const toDate = endOfDay(parseDate(params.get('toDate')));
  const accounts = await prisma.account.findMany({
    where: { tenantId, isActive: true },
    select: { code: true, nameAr: true, type: true, subType: true },
  });
  const lineTotals = await prisma.journalEntryLine.groupBy({
    by: ['accountCode'],
    where: {
      tenantId,
      journalEntry: {
        tenantId,
        isPosted: true,
        entryDate: { gte: fromDate, lte: toDate },
      },
    },
    _sum: { debit: true, credit: true },
  });

  const totalsMap = new Map(lineTotals.map((line) => [line.accountCode, { debit: Number(line._sum.debit || 0), credit: Number(line._sum.credit || 0) }]));
  const rows: Array<Array<string | number>> = [];
  let totalRevenue = 0;
  let totalCogs = 0;
  let totalExpenses = 0;

  accounts.forEach((account) => {
    const totals = totalsMap.get(account.code) || { debit: 0, credit: 0 };
    if (account.type === 'Revenue') {
      const amount = totals.credit - totals.debit;
      if (amount !== 0) {
        totalRevenue += amount;
        rows.push(['إيراد', account.code, account.nameAr, amount]);
      }
      return;
    }
    if (account.type === 'Expense' && account.subType === 'COGS') {
      const amount = totals.debit - totals.credit;
      if (amount !== 0) {
        totalCogs += amount;
        rows.push(['تكلفة مبيعات', account.code, account.nameAr, amount]);
      }
      return;
    }
    if (account.type === 'Expense') {
      const amount = totals.debit - totals.credit;
      if (amount !== 0) {
        totalExpenses += amount;
        rows.push(['مصروف تشغيلي', account.code, account.nameAr, amount]);
      }
    }
  });

  rows.push(['', '', 'إجمالي الإيرادات', totalRevenue]);
  rows.push(['', '', 'إجمالي تكلفة المبيعات', totalCogs]);
  rows.push(['', '', 'إجمالي المصروفات', totalExpenses]);
  rows.push(['', '', 'صافي الربح', totalRevenue - totalCogs - totalExpenses]);

  return {
    title: 'قائمة الدخل',
    columns: ['الفئة', 'الكود', 'الحساب', 'المبلغ'],
    rows,
  };
}

async function buildBalanceSheetDataset(tenantId: string, params: URLSearchParams): Promise<ReportDataset> {
  const asOfDate = endOfDay(parseDate(params.get('asOfDate')));
  const data = await buildBalanceSheetData(tenantId, asOfDate);
  const sections = [
    data.sections.fixedAssets,
    data.sections.currentAssets,
    data.sections.treasury,
    data.sections.inventory,
    data.sections.customers,
    data.sections.suppliers,
    data.sections.expenses,
    data.sections.liabilities,
    data.sections.equity,
  ];

  const rows: Array<Array<string | number>> = [];
  for (const section of sections) {
    rows.push([section.title, '', '', section.total]);
    for (const row of section.rows) {
      rows.push([section.title, row.label, row.source, row.amount]);
    }
  }
  rows.push(['', 'إجمالي الأصول', '', data.summary.totalAssets]);
  rows.push(['', 'إجمالي الالتزامات', '', data.summary.totalLiabilities]);
  rows.push(['', 'صافي المركز المالي', '', data.summary.netFinancialPosition]);
  rows.push(['', 'إجمالي الخصوم + حقوق الملكية', '', data.summary.totalLiabilitiesAndEquity]);
  rows.push(['', 'الفرق', '', data.summary.difference]);

  return {
    title: 'الميزانية العمومية',
    columns: ['القسم', 'البند', 'المصدر', 'القيمة'],
    rows,
  };
}

async function buildCashboxPrintDataset(tenantId: string, params: URLSearchParams): Promise<ReportDataset> {
  const fromDate = parseDate(params.get('fromDate'));
  const toDate = endOfDay(parseDate(params.get('toDate')));
  const cashboxId = params.get('cashboxId');

  const cashboxes = await (prisma as any).cashbox.findMany({
    where: { tenantId, ...(cashboxId ? { id: cashboxId } : {}) },
    select: { id: true, openingBalance: true },
  });
  const cashboxIds = cashboxes.map((c: any) => c.id);
  const rows = await (prisma as any).cashboxTransaction.findMany({
    where: { tenantId, cashboxId: { in: cashboxIds }, date: { gte: fromDate, lte: toDate } },
    include: { cashbox: { select: { code: true, name: true } } },
    orderBy: { date: 'asc' },
  });

  const totalIn = rows.filter((r: any) => r.direction === 'in').reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
  const totalOut = rows.filter((r: any) => r.direction === 'out').reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

  return {
    title: 'تقارير الخزنة',
    columns: ['التاريخ', 'الخزنة', 'نوع العملية', 'طريقة الدفع', 'داخل', 'خارج', 'الرصيد بعد العملية', 'ملاحظات'],
    rows: [
      ...rows.map((row: any) => [
        toArDate(row.date),
        `${row.cashbox?.name || '-'} (${row.cashbox?.code || '-'})`,
        row.type,
        'خزنة',
        row.direction === 'in' ? Number(row.amount || 0) : 0,
        row.direction === 'out' ? Number(row.amount || 0) : 0,
        Number(row.afterBalance || 0),
        row.description || row.referenceType || '—',
      ]),
      ['', '', '', 'إجمالي الداخل', totalIn, '', '', ''],
      ['', '', '', 'إجمالي الخارج', '', totalOut, '', ''],
    ],
  };
}

async function buildManufacturingDataset(tenantId: string, params: URLSearchParams): Promise<ReportDataset> {
  const fromDate = parseDate(params.get('fromDate'));
  const toDate = endOfDay(parseDate(params.get('toDate')));
  const orders = await prisma.productionOrder.findMany({
    where: { tenantId, date: { gte: fromDate, lte: toDate } },
    select: {
      orderNumber: true,
      date: true,
      status: true,
      quantity: true,
      actualOutputQuantity: true,
      workInProgress: { select: { totalCost: true } },
      product: { select: { code: true, nameAr: true } },
      productionLine: { select: { name: true } },
    },
    orderBy: { date: 'desc' },
  });

  return {
    title: 'تقرير التصنيع',
    columns: ['رقم الأمر', 'التاريخ', 'المنتج', 'خط الإنتاج', 'الحالة', 'الكمية المخططة', 'الكمية الفعلية', 'التكلفة'],
    rows: orders.map((order) => [
      order.orderNumber,
      toArDate(order.date),
      `${order.product?.nameAr || '-'} (${order.product?.code || '-'})`,
      order.productionLine?.name || 'بدون',
      order.status,
      Number(order.quantity || 0),
      Number(order.actualOutputQuantity || 0),
      Number(order.workInProgress?.totalCost || 0),
    ]),
  };
}

function xlsxResponse(dataset: ReportDataset): Response {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([dataset.columns, ...dataset.rows]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const filename = `${safeFilename(dataset.title)}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'no-store',
    },
  });
}

async function pdfResponse(dataset: ReportDataset): Promise<Response> {
  const document = new PDFDocument({ margin: 36, size: 'A4' });
  const chunks: Buffer[] = [];
  document.on('data', (chunk) => chunks.push(chunk));

  const fontPath = resolveArabicFontPath();
  if (fontPath) {
    document.font(fontPath);
  }

  const pageWidth = document.page.width - document.page.margins.left - document.page.margins.right;
  const columnCount = Math.max(1, dataset.columns.length);
  const columnWidth = pageWidth / columnCount;
  const rowHeight = 24;
  const startX = document.page.margins.left;

  const drawHeader = () => {
    document.fillColor('#0f172a').fontSize(16).text(dataset.title, { align: 'right' });
    document.moveDown(0.3);
    document
      .fontSize(9)
      .fillColor('#64748b')
      .text(`تاريخ التصدير: ${new Date().toLocaleString('ar-EG')}`, { align: 'right' });
    document.moveDown(0.8);
    drawTableRow(dataset.columns.map(String), true);
  };

  const drawTableRow = (row: string[], header = false) => {
    const y = document.y;
    if (y + rowHeight > document.page.height - document.page.margins.bottom) {
      document.addPage();
      if (fontPath) document.font(fontPath);
      drawHeader();
      return drawTableRow(row, header);
    }

    document.save();
    document.lineWidth(0.6).strokeColor('#cbd5e1');
    if (header) {
      document.rect(startX, y, pageWidth, rowHeight).fill('#e2e8f0');
      document.fillColor('#0f172a');
    } else {
      document.rect(startX, y, pageWidth, rowHeight).stroke();
      document.fillColor('#1e293b');
    }

    row.forEach((cell, index) => {
      const x = startX + index * columnWidth;
      if (!header) {
        document.rect(x, y, columnWidth, rowHeight).stroke();
      }
      document.text(String(cell ?? '—'), x + 6, y + 7, {
        width: columnWidth - 12,
        align: 'right',
        ellipsis: true,
      });
    });
    document.restore();
    document.y = y + rowHeight;
  };

  drawHeader();
  dataset.rows.forEach((row) => drawTableRow(row.map((cell) => String(cell ?? '—'))));

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.end();
  });
  const filename = `${safeFilename(dataset.title)}-${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'no-store',
    },
  });
}

function resolveArabicFontPath(): string | null {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const localPublicFont = path.join(process.cwd(), 'public', 'fonts', 'NotoSansArabic-Regular.ttf');
  if (fs.existsSync(localPublicFont)) return localPublicFont;
  return null;
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-');
}

function parseDate(value: string | null): Date {
  if (!value) return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function endOfDay(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(23, 59, 59, 999);
  return normalized;
}

function toArDate(value: Date): string {
  return new Date(value).toLocaleDateString('ar-EG');
}
