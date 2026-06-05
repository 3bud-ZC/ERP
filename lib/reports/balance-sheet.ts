import { prisma } from '@/lib/db';

export interface BalanceSheetLine {
  code: string;
  nameAr: string;
  amount: number;
  subType?: string | null;
}

export interface BalanceSheetData {
  asOfDate: Date;
  assets: { lines: BalanceSheetLine[]; total: number; groups: Record<string, number> };
  liabilities: { lines: BalanceSheetLine[]; total: number };
  equity: { lines: BalanceSheetLine[]; netIncome: number; total: number; totalWithIncome: number };
  summary: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    totalLiabilitiesAndEquity: number;
    isBalanced: boolean;
    difference: number;
  };
}

export async function buildBalanceSheetData(tenantId: string, asOfDate: Date): Promise<BalanceSheetData> {
  const date = new Date(asOfDate);
  if (Number.isNaN(date.getTime())) date.setTime(Date.now());

  const [accounts, lineTotals] = await Promise.all([
    prisma.account.findMany({
      where: { tenantId, isActive: true },
      select: { code: true, nameAr: true, nameEn: true, type: true, subType: true },
    }),
    prisma.journalEntryLine.groupBy({
      by: ['accountCode'],
      where: {
        tenantId,
        journalEntry: {
          tenantId,
          isPosted: true,
          entryDate: { lte: date },
        },
      },
      _sum: { debit: true, credit: true },
    }),
  ]);

  const totalsMap = new Map(
    lineTotals.map((line) => [
      line.accountCode,
      {
        debit: Number(line._sum.debit || 0),
        credit: Number(line._sum.credit || 0),
      },
    ]),
  );

  const assets: BalanceSheetLine[] = [];
  const liabilities: BalanceSheetLine[] = [];
  const equity: BalanceSheetLine[] = [];
  let revenueNet = 0;
  let expenseNet = 0;

  for (const account of accounts) {
    const totals = totalsMap.get(account.code) || { debit: 0, credit: 0 };
    const type = normalizeType(account.type);
    if (type === 'asset') {
      assets.push({
        code: account.code,
        nameAr: account.nameAr || account.nameEn || account.code,
        subType: account.subType,
        amount: totals.debit - totals.credit,
      });
    } else if (type === 'liability') {
      liabilities.push({
        code: account.code,
        nameAr: account.nameAr || account.nameEn || account.code,
        subType: account.subType,
        amount: totals.credit - totals.debit,
      });
    } else if (type === 'equity') {
      equity.push({
        code: account.code,
        nameAr: account.nameAr || account.nameEn || account.code,
        subType: account.subType,
        amount: totals.credit - totals.debit,
      });
    } else if (type === 'revenue' || type === 'income') {
      revenueNet += totals.credit - totals.debit;
    } else if (type === 'expense') {
      expenseNet += totals.debit - totals.credit;
    }
  }

  const byCode = (a: BalanceSheetLine, b: BalanceSheetLine) => a.code.localeCompare(b.code);
  assets.sort(byCode);
  liabilities.sort(byCode);
  equity.sort(byCode);

  const netIncome = revenueNet - expenseNet;
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquityRaw = sum(equity);
  const totalEquityWithIncome = totalEquityRaw + netIncome;
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquityWithIncome;
  const difference = totalAssets - totalLiabilitiesAndEquity;

  return {
    asOfDate: date,
    assets: {
      lines: assets,
      total: totalAssets,
      groups: groupAssets(assets),
    },
    liabilities: { lines: liabilities, total: totalLiabilities },
    equity: {
      lines: equity,
      netIncome,
      total: totalEquityRaw,
      totalWithIncome: totalEquityWithIncome,
    },
    summary: {
      totalAssets,
      totalLiabilities,
      totalEquity: totalEquityWithIncome,
      totalLiabilitiesAndEquity,
      isBalanced: Math.abs(difference) < 0.01,
      difference,
    },
  };
}

function normalizeType(type?: string | null): string {
  return String(type || '').trim().toLowerCase();
}

function sum(lines: BalanceSheetLine[]) {
  return lines.reduce((total, line) => total + Number(line.amount || 0), 0);
}

function groupAssets(lines: BalanceSheetLine[]) {
  const groups: Record<string, number> = {
    'النقدية': 0,
    'البنك': 0,
    'العملاء والمديونيات': 0,
    'المخزون': 0,
    'الآلات والأجهزة والأثاث والسيارات والأصول الأخرى': 0,
    'أصول أخرى': 0,
  };
  for (const line of lines) {
    const key = `${line.nameAr} ${line.subType || ''}`.toLowerCase();
    if (key.includes('cash') || key.includes('نقد')) groups['النقدية'] += line.amount;
    else if (key.includes('bank') || key.includes('بنك')) groups['البنك'] += line.amount;
    else if (key.includes('receivable') || key.includes('عميل') || key.includes('مدينة')) groups['العملاء والمديونيات'] += line.amount;
    else if (key.includes('inventory') || key.includes('مخزون')) groups['المخزون'] += line.amount;
    else if (key.includes('fixed') || key.includes('asset') || key.includes('أصل') || key.includes('أصول') || key.includes('معدات') || key.includes('سيارات') || key.includes('أثاث') || key.includes('آلات')) groups['الآلات والأجهزة والأثاث والسيارات والأصول الأخرى'] += line.amount;
    else groups['أصول أخرى'] += line.amount;
  }
  return groups;
}
