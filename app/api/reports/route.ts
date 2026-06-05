import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { getAuthenticatedUser, checkPermission } from '@/lib/auth';
import { buildBalanceSheetData } from '@/lib/reports/balance-sheet';

// Disable caching for real-time data
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ==================== PROFIT & LOSS STATEMENT ====================

async function getProfitAndLossReport(tenantId: string, fromDate?: Date, toDate?: Date) {
  const startDate = fromDate || new Date(new Date().getFullYear(), 0, 1);
  const endDate = toDate || new Date();

  const revenueEntries = await prisma.journalEntry.findMany({
    where: {
      tenantId,
      isPosted: true,
      entryDate: {
        gte: startDate,
        lte: endDate,
      },
      referenceType: 'SalesInvoice',
    },
    include: { lines: true },
  });

  const expenseEntries = await prisma.journalEntry.findMany({
    where: {
      tenantId,
      isPosted: true,
      entryDate: {
        gte: startDate,
        lte: endDate,
      },
      referenceType: { in: ['Expense', 'ProductionOrder'] },
    },
    include: { lines: true },
  });

  let totalRevenue = 0;
  let totalCOGS = 0;
  let totalOperatingExpenses = 0;

  revenueEntries.forEach((entry) => {
    entry.lines.forEach((line) => {
      if (line.accountCode === '4010') {
        totalRevenue += Number(line.credit) - Number(line.debit);
      }
      if (line.accountCode === '5010') {
        totalCOGS += Number(line.debit) - Number(line.credit);
      }
    });
  });

  expenseEntries.forEach((entry) => {
    entry.lines.forEach((line) => {
      if (['5020', '5030', '5040', '5050', '5060'].includes(line.accountCode)) {
        totalOperatingExpenses += Number(line.debit) - Number(line.credit);
      }
    });
  });

  const grossProfit = totalRevenue - totalCOGS;
  const operatingIncome = grossProfit - totalOperatingExpenses;
  const netIncome = operatingIncome;

  return {
    period: { from: startDate, to: endDate },
    revenue: {
      salesRevenue: totalRevenue,
    },
    costOfGoodsSold: totalCOGS,
    grossProfit,
    operatingExpenses: {
      salaries: 0,
      rent: 0,
      utilities: 0,
      marketing: 0,
      miscellaneous: 0,
      total: totalOperatingExpenses,
    },
    operatingIncome,
    otherIncome: 0,
    netIncome,
  };
}

// ==================== BALANCE SHEET ====================

async function getBalanceSheet(tenantId: string, asOfDate?: Date) {
  const date = asOfDate || new Date();
  const data = await buildBalanceSheetData(tenantId, date);

  return {
    asOfDate: date,
    assets: {
      items: Object.fromEntries(data.assets.lines.map((row) => [row.code, { code: row.code, nameAr: row.label, balance: row.amount }])),
      total: data.summary.totalAssets,
    },
    liabilities: {
      items: Object.fromEntries(data.liabilities.lines.map((row) => [row.code, { code: row.code, nameAr: row.label, balance: row.amount }])),
      total: data.summary.totalLiabilities,
    },
    equity: {
      items: Object.fromEntries(data.equity.lines.map((row) => [row.code, { code: row.code, nameAr: row.label, balance: row.amount }])),
      total: data.summary.totalEquity,
    },
    summary: {
      totalAssets: data.summary.totalAssets,
      totalLiabilitiesAndEquity: data.summary.totalLiabilitiesAndEquity,
      isBalanced: data.summary.isBalanced,
    },
  };
}

// ==================== CASH FLOW REPORT ====================

async function getCashFlowReport(tenantId: string, fromDate?: Date, toDate?: Date) {
  const startDate = fromDate || new Date(new Date().getFullYear(), 0, 1);
  const endDate = toDate || new Date();

  const allEntries = await prisma.journalEntry.findMany({
    where: {
      tenantId,
      isPosted: true,
      entryDate: { gte: startDate, lte: endDate },
    },
    include: { lines: true },
  });

  let operatingCash = 0;
  let investingCash = 0;
  let financingCash = 0;

  allEntries.forEach((entry: any) => {
    entry.lines.forEach((line: any) => {
      const accountCode = line.accountCode;
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      const netCash = debit - credit;

      // Operating activities: Revenue, expenses, AR/AP changes
      // Accounts: 1001 (Cash), 1010 (Bank), 1021 (AR), 2011 (AP), 4xxx (Revenue), 5xxx (Expenses)
      if (['1001', '1010'].includes(accountCode)) {
        // Cash and bank accounts - determine activity type based on reference type
        if (['SalesInvoice', 'SalesReturn', 'PurchaseInvoice', 'PurchaseReturn', 'Payment'].includes(entry.referenceType || '')) {
          operatingCash += netCash;
        } else if (['FixedAsset', 'AssetSale'].includes(entry.referenceType || '')) {
          investingCash += netCash;
        } else if (['Loan', 'Capital', 'Dividend'].includes(entry.referenceType || '')) {
          financingCash += netCash;
        } else {
          // Default to operating for manual entries
          operatingCash += netCash;
        }
      }

      // Investing activities: Fixed assets (account 12xx)
      if (accountCode.startsWith('12')) {
        investingCash += netCash;
      }

      // Financing activities: Loans (account 20xx), Capital (account 30xx), Dividends (account 4020)
      if (accountCode.startsWith('20') || accountCode.startsWith('30') || accountCode === '4020') {
        financingCash += netCash;
      }
    });
  });

  const netCashIncrease = operatingCash + investingCash + financingCash;

  return {
    period: { from: startDate, to: endDate },
    operatingActivities: {
      description: 'Cash from operations',
      amount: operatingCash,
    },
    investingActivities: {
      description: 'Cash from investing',
      amount: investingCash,
    },
    financingActivities: {
      description: 'Cash from financing',
      amount: financingCash,
    },
    netCashIncrease,
  };
}

// ==================== INVENTORY VALUATION ====================

async function getInventoryValuation(tenantId: string) {
  const products = await prisma.product.findMany({
    where: { tenantId, stock: { gt: 0 } },
    include: { inventoryTransactions: true },
  });

  let totalInventoryValue = 0;
  const items: any[] = [];

  for (const product of products) {
    const value = product.stock * product.cost;
    totalInventoryValue += value;

    items.push({
      productCode: product.code,
      productName: product.nameAr || product.nameEn,
      quantity: product.stock,
      unitCost: product.cost,
      totalValue: value,
    });
  }

  return {
    asOfDate: new Date(),
    items,
    totalValue: totalInventoryValue,
    itemCount: items.length,
  };
}

// ==================== API ROUTES ====================

// GET - Read reports
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'view_financial_reports')) return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    const tenantId = user.tenantId;

    const { searchParams } = new URL(request.url);
    const reportType = searchParams.get('type') || 'summary';
    const fromDate = searchParams.get('fromDate') ? new Date(searchParams.get('fromDate')!) : undefined;
    const toDate = searchParams.get('toDate') ? new Date(searchParams.get('toDate')!) : undefined;

    let report: any = {};

    switch (reportType) {
      case 'profit-loss':
        report.profitAndLoss = await getProfitAndLossReport(tenantId, fromDate, toDate);
        break;
      case 'balance-sheet':
        report.balanceSheet = await getBalanceSheet(tenantId, toDate);
        break;
      case 'cash-flow':
        report.cashFlow = await getCashFlowReport(tenantId, fromDate, toDate);
        break;
      case 'inventory':
        report.inventory = await getInventoryValuation(tenantId);
        break;
      case 'summary':
      default:
        report = {
          profitAndLoss: await getProfitAndLossReport(tenantId, fromDate, toDate),
          balanceSheet: await getBalanceSheet(tenantId, toDate),
          cashFlow: await getCashFlowReport(tenantId, fromDate, toDate),
          inventory: await getInventoryValuation(tenantId),
        };
        break;
    }

    return apiSuccess(report, 'تم جلب التقرير بنجاح');
  } catch (error) {
    return handleApiError(error, 'Generate report');
  }
}
