import { prisma } from '@/lib/db';
import { calculateProfitAndLoss } from '@/lib/accounting';
import { openingNet } from '@/lib/services/party-debt.service';

export type BalanceSheetClassification = 'asset' | 'liability' | 'equity' | 'memo';

export interface BalanceSheetRow {
  key: string;
  code: string;
  label: string;
  amount: number;
  source: string;
  classification: BalanceSheetClassification;
  note?: string | null;
}

export interface BalanceSheetSection {
  key: string;
  title: string;
  total: number;
  note?: string | null;
  rows: BalanceSheetRow[];
}

export interface BalanceSheetData {
  asOfDate: Date;
  sections: {
    fixedAssets: BalanceSheetSection;
    currentAssets: BalanceSheetSection;
    treasury: BalanceSheetSection;
    customers: BalanceSheetSection;
    suppliers: BalanceSheetSection;
    inventory: BalanceSheetSection;
    expenses: BalanceSheetSection;
    liabilities: BalanceSheetSection;
    equity: BalanceSheetSection;
  };
  assets: {
    lines: BalanceSheetRow[];
    total: number;
    groups: Record<string, number>;
  };
  liabilities: {
    lines: BalanceSheetRow[];
    total: number;
  };
  equity: {
    lines: BalanceSheetRow[];
    netIncome: number;
    total: number;
    totalWithIncome: number;
  };
  summary: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    totalLiabilitiesAndEquity: number;
    netFinancialPosition: number;
    treasuryCash: number;
    bankBalance: number;
    isBalanced: boolean;
    difference: number;
  };
}

const FIXED_ASSET_GROUPS = [
  { key: 'machines', label: 'الآلات', keywords: ['آلة', 'ماكينة', 'machin', 'machine', 'line'] },
  { key: 'furniture', label: 'الأثاث', keywords: ['أثاث', 'مكتب', 'كرسي', 'طاولة', 'desk', 'chair', 'furniture'] },
  { key: 'devices', label: 'الأجهزة', keywords: ['جهاز', 'device', 'laptop', 'computer', 'printer', 'scanner', 'tablet'] },
  { key: 'vehicles', label: 'السيارات', keywords: ['سيارة', 'car', 'vehicle', 'van', 'truck', 'pickup'] },
  { key: 'other', label: 'أصول أخرى', keywords: [] as string[] },
] as const;

const MANUAL_EXPENSE_LABELS: Record<string, string> = {
  rent: 'الإيجار',
  electricity: 'شحن الكهرباء',
  wages: 'الرواتب',
  maintenance: 'مصاريف الصيانة',
  colors_grease: 'مصاريف ألوان وشحوم',
  papers_solitaire: 'مصاريف أوراق وسوليتب',
  production_cost: 'تكلفة إنتاج',
  expense: 'مصروف تشغيلي',
  contractor: 'سداد طرف خارجي',
  other: 'مصروف آخر',
};

export async function buildBalanceSheetData(tenantId: string, asOfDate: Date): Promise<BalanceSheetData> {
  const date = normalizeDate(asOfDate);
  const yearStart = new Date(date.getFullYear(), 0, 1);

  const [
    fixedAssets,
    cashboxes,
    cashboxTransactions,
    journalBalances,
    customers,
    salesInvoices,
    customerPayments,
    customerDebtRows,
    suppliers,
    purchaseInvoices,
    supplierPayments,
    supplierDebtRows,
    products,
    inventoryValuations,
    workInProgressRows,
    expenses,
    pendingExpenses,
    accruals,
    accounts,
    profitAndLoss,
  ] = await Promise.all([
    prisma.fixedAsset.findMany({
      where: {
        tenantId,
        purchaseDate: { lte: date },
        OR: [
          { disposedAt: null },
          { disposedAt: { gt: date } },
        ],
      },
      select: {
        id: true,
        assetNumber: true,
        name: true,
        description: true,
        purchaseDate: true,
        netBookValue: true,
        status: true,
        disposedAt: true,
        depreciationSchedules: {
          select: { period: true, netBookValue: true },
          orderBy: { period: 'asc' },
        },
      },
      orderBy: { purchaseDate: 'asc' },
    }),
    prisma.cashbox.findMany({
      where: { tenantId, createdAt: { lte: date } },
      select: {
        id: true,
        code: true,
        name: true,
        currency: true,
        openingBalance: true,
        status: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.cashboxTransaction.findMany({
      where: {
        tenantId,
        date: { lte: date },
      },
      select: {
        cashboxId: true,
        direction: true,
        amount: true,
        date: true,
        referenceType: true,
        referenceId: true,
        description: true,
      },
      orderBy: { date: 'asc' },
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
    prisma.customer.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        code: true,
        nameAr: true,
        openingBalanceType: true,
        openingBalanceAmount: true,
        openingBalanceDate: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.salesInvoice.groupBy({
      by: ['customerId'],
      where: {
        tenantId,
        date: { lte: date },
      },
      _sum: { total: true, grandTotal: true, paidAmount: true },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ['customerId'],
      where: {
        tenantId,
        type: 'incoming',
        customerId: { not: null },
        date: { lte: date },
      },
      _sum: { amount: true },
    }),
    prisma.partyDebtTransaction.findMany({
      where: {
        tenantId,
        partyType: 'customer',
        date: { lte: date },
      },
      select: {
        customerId: true,
        transactionType: true,
        amount: true,
        date: true,
        notes: true,
      },
      orderBy: { date: 'asc' },
    }),
    prisma.supplier.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        code: true,
        nameAr: true,
        openingBalanceType: true,
        openingBalanceAmount: true,
        openingBalanceDate: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.purchaseInvoice.groupBy({
      by: ['supplierId'],
      where: {
        tenantId,
        date: { lte: date },
      },
      _sum: { total: true, grandTotal: true, paidAmount: true },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ['supplierId'],
      where: {
        tenantId,
        type: 'outgoing',
        supplierId: { not: null },
        date: { lte: date },
      },
      _sum: { amount: true },
    }),
    prisma.partyDebtTransaction.findMany({
      where: {
        tenantId,
        partyType: 'supplier',
        date: { lte: date },
      },
      select: {
        supplierId: true,
        transactionType: true,
        amount: true,
        date: true,
        notes: true,
      },
      orderBy: { date: 'asc' },
    }),
    prisma.product.findMany({
      where: { tenantId, isActive: true, stock: { gt: 0 } },
      select: {
        id: true,
        code: true,
        nameAr: true,
        nameEn: true,
        type: true,
        stock: true,
        cost: true,
        minStock: true,
      },
      orderBy: { nameAr: 'asc' },
    }),
    prisma.inventoryValuation.findMany({
      where: { tenantId },
      select: {
        productId: true,
        totalQuantity: true,
        totalValue: true,
        averageCost: true,
        lastUpdated: true,
        product: { select: { code: true, nameAr: true, type: true, stock: true, cost: true } },
      },
    }),
    prisma.workInProgress.findMany({
      where: { tenantId, status: { not: 'cancelled' } },
      select: {
        id: true,
        totalCost: true,
        status: true,
        productionOrder: { select: { orderNumber: true, product: { select: { code: true, nameAr: true } } } },
      },
    }),
    prisma.expense.findMany({
      where: {
        tenantId,
        date: { gte: yearStart, lte: date },
        status: 'paid',
      },
      select: {
        id: true,
        category: true,
        description: true,
        amount: true,
        total: true,
        date: true,
        cashboxId: true,
        cashbox: { select: { id: true, code: true, name: true, currency: true } },
      },
      orderBy: { date: 'asc' },
    }),
    prisma.expense.findMany({
      where: {
        tenantId,
        date: { lte: date },
        status: { not: 'paid' },
      },
      select: {
        id: true,
        category: true,
        description: true,
        total: true,
        amount: true,
        date: true,
        notes: true,
        supplierId: true,
        cashboxId: true,
      },
      orderBy: { date: 'asc' },
    }),
    prisma.accrual.findMany({
      where: {
        tenantId,
        status: 'pending',
        periodEndDate: { lte: date },
      },
      select: {
        id: true,
        accrualNumber: true,
        type: true,
        accountCode: true,
        amount: true,
        description: true,
        periodStartDate: true,
        periodEndDate: true,
      },
      orderBy: { periodEndDate: 'asc' },
    }),
    prisma.account.findMany({
      where: {
        tenantId,
        isActive: true,
        code: { in: ['1010', '1021', '2011', '2020', '2030', '3010', '3020', '4030'] },
      },
      select: {
        code: true,
        nameAr: true,
        type: true,
        subType: true,
      },
    }),
    calculateProfitAndLoss(yearStart, date, tenantId),
  ]);

  const accountTotals = toBalanceMap(journalBalances);
  const accountLookup = new Map(accounts.map((account) => [account.code, account]));

  const assetLines: BalanceSheetRow[] = [];
  const liabilityLines: BalanceSheetRow[] = [];
  const equityLines: BalanceSheetRow[] = [];

  const fixedAssetsSection = buildFixedAssetsSection(fixedAssets, date, assetLines);
  const treasurySection = buildTreasurySection(cashboxes, cashboxTransactions, accountTotals, accountLookup, assetLines);
  const inventorySection = buildInventorySection(products, inventoryValuations, workInProgressRows, assetLines);
  const customerSection = buildCustomerSection(customers, salesInvoices, customerPayments, customerDebtRows);
  const supplierSection = buildSupplierSection(suppliers, purchaseInvoices, supplierPayments, supplierDebtRows);
  const expensesSection = buildExpensesSection(expenses, pendingExpenses);
  const liabilitiesSection = buildLiabilitiesSection(accountTotals, accountLookup, pendingExpenses, accruals, customerSection, supplierSection, liabilityLines);
  const equitySection = buildEquitySection(accountTotals, accountLookup, profitAndLoss.netProfit, equityLines);

  const currentAssetsSection = buildCurrentAssetsSection(accountTotals, accountLookup, inventorySection, treasurySection, customerSection, supplierSection, assetLines);

  const totalAssets = sumRows(assetLines);
  const totalLiabilities = sumRows(liabilityLines);
  const equityWithoutIncome = sumRows(equityLines);
  const totalEquityWithIncome = equityWithoutIncome + Number(profitAndLoss.netProfit || 0);
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquityWithIncome;
  const difference = totalAssets - totalLiabilitiesAndEquity;

  return {
    asOfDate: date,
    sections: {
      fixedAssets: fixedAssetsSection,
      currentAssets: currentAssetsSection,
      treasury: treasurySection,
      customers: customerSection,
      suppliers: supplierSection,
      inventory: inventorySection,
      expenses: expensesSection,
      liabilities: liabilitiesSection,
      equity: equitySection,
    },
    assets: {
      lines: assetLines,
      total: totalAssets,
      groups: fixedAssetsSection.rows.reduce<Record<string, number>>((acc, row) => {
        acc[row.label] = row.amount;
        return acc;
      }, {}),
    },
    liabilities: {
      lines: liabilityLines,
      total: totalLiabilities,
    },
    equity: {
      lines: equityLines,
      netIncome: Number(profitAndLoss.netProfit || 0),
      total: equityWithoutIncome,
      totalWithIncome: totalEquityWithIncome,
    },
    summary: {
      totalAssets,
      totalLiabilities,
      totalEquity: totalEquityWithIncome,
      totalLiabilitiesAndEquity,
      netFinancialPosition: totalAssets - totalLiabilities,
      treasuryCash: treasurySection.rows
        .filter((row) => row.code.startsWith('CASH'))
        .reduce((s, row) => s + row.amount, 0),
      bankBalance: treasurySection.rows
        .filter((row) => row.code.startsWith('BANK'))
        .reduce((s, row) => s + row.amount, 0),
      isBalanced: Math.abs(difference) < 0.01,
      difference,
    },
  };
}

function buildFixedAssetsSection(
  fixedAssets: Array<{
    id: string;
    assetNumber: string;
    name: string;
    description: string | null;
    purchaseDate: Date;
    netBookValue: number;
    status: string;
    disposedAt: Date | null;
    depreciationSchedules: Array<{ period: string; netBookValue: number }>;
  }>,
  asOfDate: Date,
  assetLines: BalanceSheetRow[],
): BalanceSheetSection {
  const bucket = new Map(FIXED_ASSET_GROUPS.map((group) => [group.key, 0]));
  const details = new Map(FIXED_ASSET_GROUPS.map((group) => [group.key, [] as string[]]));

  for (const asset of fixedAssets) {
    const amount = resolveFixedAssetAmount(asset, asOfDate);
    const group = classifyFixedAsset(asset.name, asset.description);
    bucket.set(group.key, (bucket.get(group.key) || 0) + amount);
    details.get(group.key)?.push(`${asset.name} (${asset.assetNumber})`);
  }

  const rows = FIXED_ASSET_GROUPS.map((group) => {
    const amount = roundMoney(bucket.get(group.key) || 0);
    const names = details.get(group.key) || [];
    const row = buildRow(
      `FA-${group.key}`,
      group.label,
      amount,
      'FixedAsset',
      'asset',
      'asset',
      names.length ? `${names.length} أصل` : '—',
    );
    if (amount > 0) assetLines.push(row);
    return row;
  });

  return {
    key: 'fixedAssets',
    title: 'الأصول الثابتة',
    total: sumRows(rows),
    note: 'القيمة الدفترية الصافية حسب بطاقة الأصل وسجلات الإهلاك عند توفرها',
    rows,
  };
}

function buildTreasurySection(
  cashboxes: Array<{ id: string; code: string; name: string; currency: string; openingBalance: number; status: string; createdAt: Date }>,
  cashboxTransactions: Array<{ cashboxId: string; direction: string; amount: number; date: Date; referenceType: string | null; referenceId: string | null; description: string | null }>,
  accountTotals: Map<string, { debit: number; credit: number }>,
  accountLookup: Map<string, { code: string; nameAr: string; type: string; subType: string | null }>,
  assetLines: BalanceSheetRow[],
): BalanceSheetSection {
  const txByCashbox = new Map<string, { inflow: number; outflow: number }>();
  for (const tx of cashboxTransactions) {
    const entry = txByCashbox.get(tx.cashboxId) || { inflow: 0, outflow: 0 };
    if (tx.direction === 'in') entry.inflow += Number(tx.amount || 0);
    else entry.outflow += Number(tx.amount || 0);
    txByCashbox.set(tx.cashboxId, entry);
  }

  const cashTotalsByCurrency = new Map<string, number>();
  const cashboxRows: BalanceSheetRow[] = [];
  for (const cashbox of cashboxes) {
    const movement = txByCashbox.get(cashbox.id) || { inflow: 0, outflow: 0 };
    const balance = roundMoney(Number(cashbox.openingBalance || 0) + movement.inflow - movement.outflow);
    cashTotalsByCurrency.set(cashbox.currency || 'EGP', (cashTotalsByCurrency.get(cashbox.currency || 'EGP') || 0) + balance);
    const row = buildRow(
      `CASH-${cashbox.code}`,
      `الخزنة - ${cashbox.name}`,
      balance,
      'Cashbox',
      'asset',
      'asset',
      `${cashbox.currency || 'EGP'} • ${cashbox.status === 'active' ? 'نشطة' : 'غير نشطة'}`,
    );
    if (Math.abs(balance) > 0.005) {
      cashboxRows.push(row);
      assetLines.push(row);
    }
  }

  const bankBalance = getHistoricalAccountBalance('1010', accountTotals, accountLookup);
  if (Math.abs(bankBalance) > 0.005) {
    const bankRow = buildRow('BANK-1010', 'الحسابات البنكية', bankBalance, 'Account 1010', 'asset', 'asset', 'الرصيد الدفتري حتى تاريخ التقرير');
    assetLines.push(bankRow);
    cashboxRows.push(bankRow);
  }

  const currencyRows = Array.from(cashTotalsByCurrency.entries())
    .filter(([currency]) => currency && currency !== 'EGP')
    .map(([currency, amount]) => buildRow(`CUR-${currency}`, `عملات - ${currency}`, amount, 'Cashbox', 'asset', 'asset', 'رصيد خزائن بعملة أجنبية'));

  for (const row of currencyRows) {
    if (Math.abs(row.amount) > 0.005) {
      assetLines.push(row);
      cashboxRows.push(row);
    }
  }

  return {
    key: 'treasury',
    title: 'الخزنة والبنك',
    total: sumRows(cashboxRows),
    note: 'الرصيد محسوب تاريخيًا من حركات الخزنة والقيود البنكية حتى تاريخ التقرير',
    rows: cashboxRows,
  };
}

function buildInventorySection(
  products: Array<{ id: string; code: string; nameAr: string; nameEn: string | null; type: string; stock: number; cost: number; minStock: number }>,
  valuations: Array<{ productId: string; totalQuantity: number; totalValue: number; averageCost: number; lastUpdated: Date; product: { code: string; nameAr: string; type: string; stock: number; cost: number } }>,
  workInProgressRows: Array<{ id: string; totalCost: number; status: string; productionOrder: { orderNumber: string; product: { code: string; nameAr: string } } | null }>,
  assetLines: BalanceSheetRow[],
): BalanceSheetSection {
  const valuationMap = new Map(valuations.map((row) => [row.productId, Number(row.totalValue || 0)]));
  const productRows = products.map((product) => {
    const value = roundMoney(valuationMap.get(product.id) ?? Number(product.stock || 0) * Number(product.cost || 0));
    return {
      ...product,
      value,
      bucket: classifyInventoryProduct(product.type),
    };
  });

  const rawMaterials = roundMoney(productRows.filter((p) => p.bucket === 'raw').reduce((s, p) => s + p.value, 0));
  const finishedProducts = roundMoney(productRows.filter((p) => p.bucket === 'finished').reduce((s, p) => s + p.value, 0));
  const otherMaterials = roundMoney(productRows.filter((p) => p.bucket === 'other').reduce((s, p) => s + p.value, 0));
  const wipValue = roundMoney(workInProgressRows.reduce((s, row) => s + Number(row.totalCost || 0), 0));

  const rows = [
    buildRow('INV-RAW', 'المواد الخام', rawMaterials, 'Inventory', 'asset', 'asset', productRows.some((p) => p.bucket === 'raw') ? 'وفق رصيد المنتجات الخام' : '—'),
    buildRow('INV-FIN', 'المنتجات النهائية', finishedProducts, 'Inventory', 'asset', 'asset', productRows.some((p) => p.bucket === 'finished') ? 'وفق رصيد المنتجات الجاهزة' : '—'),
    buildRow('INV-OTH', 'مواد / منتجات أخرى', otherMaterials, 'Inventory', 'asset', 'asset', productRows.some((p) => p.bucket === 'other') ? 'بنود لا تنطبق عليها تصنيفات المخزون القياسية' : '—'),
    buildRow('INV-WIP', 'الإنتاج قيد التنفيذ', wipValue, 'WorkInProgress', 'asset', 'asset', workInProgressRows.length ? `${workInProgressRows.length} أمر` : '—'),
  ];

  for (const row of rows) {
    if (Math.abs(row.amount) > 0.005) assetLines.push(row);
  }

  return {
    key: 'inventory',
    title: 'المخزون',
    total: sumRows(rows),
    note: 'القيمة تعتمد على تقييمات المخزون الحالية أو تكلفة الشراء عند غياب التقييم التفصيلي',
    rows,
  };
}

function buildCurrentAssetsSection(
  accountTotals: Map<string, { debit: number; credit: number }>,
  accountLookup: Map<string, { code: string; nameAr: string; type: string; subType: string | null }>,
  inventorySection: BalanceSheetSection,
  treasurySection: BalanceSheetSection,
  customerSection: BalanceSheetSection,
  supplierSection: BalanceSheetSection,
  assetLines: BalanceSheetRow[],
): BalanceSheetSection {
  const unbilledReceivable = getHistoricalAccountBalance('1021', accountTotals, accountLookup);
  const customerReceivable = customerSection.rows.find((row) => row.code === 'CUST-REC')?.amount || 0;
  const supplierDebit = supplierSection.rows.find((row) => row.code === 'SUP-REC')?.amount || 0;
  const rows = [
    buildRow('CA-INV', 'المخزون والإمدادات', inventorySection.total, 'Inventory', 'asset', 'asset', 'المخزون المبين في قسم المخزون'),
    buildRow('CA-WIP', 'الإنتاج قيد التنفيذ', inventorySection.rows.find((row) => row.code === 'INV-WIP')?.amount || 0, 'WorkInProgress', 'asset', 'asset', 'من الأعمال تحت التنفيذ'),
    buildRow('CA-AR', 'مستحقات غير مفوترة على العملاء', Math.max(0, unbilledReceivable), 'Account 1021', 'asset', 'asset', 'إن وُجدت قيود غير مفوترة'),
    buildRow('CA-CUST', 'مستحقات على العملاء', Math.max(0, customerReceivable), 'Customer', 'asset', 'asset', 'رصيد العملاء المستحق لنا'),
    buildRow('CA-SUP', 'أرصدة مدينة على الموردين', Math.max(0, supplierDebit), 'PartyDebt', 'asset', 'asset', 'الأرصدة التي يدين بها الموردون لنا'),
  ].filter((row) => Math.abs(row.amount) > 0.005);

  for (const row of rows) assetLines.push(row);

  return {
    key: 'currentAssets',
    title: 'الأصول المتداولة',
    total: sumRows(rows),
    note: `الأرقام المتداولة لا تشمل الخزنة والبنك لأنهما معروضان في قسم مستقل بقيمة ${money(treasurySection.total)}، بينما يظهر تفصيل العملاء في قسمه الخاص بقيمة ${money(customerSection.total)}`,
    rows,
  };
}

function buildCustomerSection(
  customers: Array<{ id: string; code: string; nameAr: string; openingBalanceType: string | null; openingBalanceAmount: number; openingBalanceDate: Date | null }>,
  salesInvoices: Array<{ customerId: string | null; _sum: { total: number | null; grandTotal: number | null; paidAmount: number | null }; _count: { _all: number } }>,
  customerPayments: Array<{ customerId: string | null; _sum: { amount: number | null } }>,
  customerDebtRows: Array<{ customerId: string | null; transactionType: string; amount: number; date: Date; notes: string | null }>,
): BalanceSheetSection {
  const invoiceMap = new Map<string, { gross: number; paid: number; count: number }>();
  for (const row of salesInvoices) {
    if (!row.customerId) continue;
    invoiceMap.set(row.customerId, {
      gross: Number(row._sum.grandTotal || row._sum.total || 0),
      paid: Number(row._sum.paidAmount || 0),
      count: row._count._all,
    });
  }

  const paymentMap = new Map<string, number>();
  for (const row of customerPayments) {
    if (!row.customerId) continue;
    paymentMap.set(row.customerId, Number(row._sum.amount || 0));
  }

  const debtMap = new Map<string, { collection: number; refund: number }>();
  for (const row of customerDebtRows) {
    if (!row.customerId) continue;
    const entry = debtMap.get(row.customerId) || { collection: 0, refund: 0 };
    if (row.transactionType === 'customer_collection') entry.collection += Number(row.amount || 0);
    if (row.transactionType === 'customer_refund') entry.refund += Number(row.amount || 0);
    debtMap.set(row.customerId, entry);
  }

  const detailRows: BalanceSheetRow[] = [];
  let receivableTotal = 0;
  let creditTotal = 0;
  let collectionsTotal = 0;

  for (const customer of customers) {
    const opening = openingNet('customer', customer.openingBalanceType, customer.openingBalanceAmount);
    const invoice = invoiceMap.get(customer.id) || { gross: 0, paid: 0, count: 0 };
    const debt = debtMap.get(customer.id) || { collection: 0, refund: 0 };
    const payments = paymentMap.get(customer.id) || 0;
    const net = roundMoney(opening + (invoice.gross - invoice.paid) - debt.collection + debt.refund);
    collectionsTotal += payments + debt.collection;
    if (net > 0) receivableTotal += net;
    if (net < 0) creditTotal += Math.abs(net);
    detailRows.push(
      buildRow(`CUST-${customer.code}`, customer.nameAr, net, 'Customer', net >= 0 ? 'asset' : 'liability', 'memo', `فواتير: ${money(invoice.gross)} • محصل: ${money(invoice.paid + debt.collection + payments)}`),
    );
  }

  const totalNet = roundMoney(receivableTotal - creditTotal);
  const assetRow = buildRow('CUST-REC', 'مستحقات على العملاء', receivableTotal, 'Invoices', 'asset', 'asset', 'إجمالي المبالغ التي ما زالت مستحقة على العملاء');
  const liabilityRow = buildRow('CUST-CRED', 'أرصدة دائنة للعملاء', creditTotal, 'CustomerCredit', 'liability', 'liability', 'عملاء تم السداد لهم أكثر من اللازم أو لديهم رصيد دائن');
  const collectionRow = buildRow('CUST-COL', 'إجمالي التحصيلات من العملاء', collectionsTotal, 'Payments', 'memo', 'memo', 'تحصيلات نقدية أو بنكية مرتبطة بالعملاء');
  const netRow = buildRow('CUST-NET', 'صافي مديونية العملاء', totalNet, 'Summary', totalNet >= 0 ? 'asset' : 'liability', 'memo', totalNet >= 0 ? 'صافي ما لنا عند العملاء' : 'صافي ما علينا للعملاء');

  return {
    key: 'customers',
    title: 'العملاء والمديونيات',
    total: totalNet,
    note: 'التحصيلات هنا معلومات تشغيلية، بينما الرصيد الصافي ينعكس في الأصول أو الالتزامات حسب النوع',
    rows: [assetRow, collectionRow, liabilityRow, netRow, ...detailRows.slice(0, 10)],
  };
}

function buildSupplierSection(
  suppliers: Array<{ id: string; code: string; nameAr: string; openingBalanceType: string | null; openingBalanceAmount: number; openingBalanceDate: Date | null }>,
  purchaseInvoices: Array<{ supplierId: string | null; _sum: { total: number | null; grandTotal: number | null; paidAmount: number | null }; _count: { _all: number } }>,
  supplierPayments: Array<{ supplierId: string | null; _sum: { amount: number | null } }>,
  supplierDebtRows: Array<{ supplierId: string | null; transactionType: string; amount: number; date: Date; notes: string | null }>,
): BalanceSheetSection {
  const invoiceMap = new Map<string, { gross: number; paid: number; count: number }>();
  for (const row of purchaseInvoices) {
    if (!row.supplierId) continue;
    invoiceMap.set(row.supplierId, {
      gross: Number(row._sum.grandTotal || row._sum.total || 0),
      paid: Number(row._sum.paidAmount || 0),
      count: row._count._all,
    });
  }

  const paymentMap = new Map<string, number>();
  for (const row of supplierPayments) {
    if (!row.supplierId) continue;
    paymentMap.set(row.supplierId, Number(row._sum.amount || 0));
  }

  const debtMap = new Map<string, { payment: number; refund: number }>();
  for (const row of supplierDebtRows) {
    if (!row.supplierId) continue;
    const entry = debtMap.get(row.supplierId) || { payment: 0, refund: 0 };
    if (row.transactionType === 'supplier_payment') entry.payment += Number(row.amount || 0);
    if (row.transactionType === 'supplier_refund') entry.refund += Number(row.amount || 0);
    debtMap.set(row.supplierId, entry);
  }

  const detailRows: BalanceSheetRow[] = [];
  let payableTotal = 0;
  let debitTotal = 0;
  let paymentsTotal = 0;

  for (const supplier of suppliers) {
    const opening = openingNet('supplier', supplier.openingBalanceType, supplier.openingBalanceAmount);
    const invoice = invoiceMap.get(supplier.id) || { gross: 0, paid: 0, count: 0 };
    const debt = debtMap.get(supplier.id) || { payment: 0, refund: 0 };
    const payments = paymentMap.get(supplier.id) || 0;
    const net = roundMoney(opening + (invoice.gross - invoice.paid) - debt.payment + debt.refund);
    paymentsTotal += payments + debt.payment;
    if (net > 0) payableTotal += net;
    if (net < 0) debitTotal += Math.abs(net);
    detailRows.push(
      buildRow(`SUP-${supplier.code}`, supplier.nameAr, net, 'Supplier', net >= 0 ? 'liability' : 'asset', 'memo', `فواتير: ${money(invoice.gross)} • مسدد: ${money(invoice.paid + debt.payment + payments)}`),
    );
  }

  const totalNet = roundMoney(payableTotal - debitTotal);
  const liabilityRow = buildRow('SUP-PAY', 'مستحقات للموردين', payableTotal, 'Invoices', 'liability', 'liability', 'إجمالي المبالغ التي ما زالت مستحقة للموردين');
  const assetRow = buildRow('SUP-REC', 'أرصدة مدينة على الموردين', debitTotal, 'SupplierDebit', 'asset', 'asset', 'موردون لديهم رصيد دائن لصالحنا');
  const paymentRow = buildRow('SUP-SEND', 'إجمالي السداد للموردين', paymentsTotal, 'Payments', 'memo', 'memo', 'سداد مرتبط بالموردين خلال الفترة');
  const netRow = buildRow('SUP-NET', 'صافي مديونية الموردين', totalNet, 'Summary', totalNet >= 0 ? 'liability' : 'asset', 'memo', totalNet >= 0 ? 'صافي ما علينا للموردين' : 'صافي ما لنا عند الموردين');

  return {
    key: 'suppliers',
    title: 'الموردين والالتزامات',
    total: totalNet,
    note: 'السداد هنا معلومات تشغيلية، بينما الرصيد الصافي ينعكس في الأصول أو الالتزامات حسب النوع',
    rows: [liabilityRow, paymentRow, assetRow, netRow, ...detailRows.slice(0, 10)],
  };
}

function buildExpensesSection(
  expenses: Array<{ id: string; category: string; description: string; amount: number; total: number; date: Date; cashboxId: string | null; cashbox: { id: string; code: string; name: string; currency: string } | null }>,
  pendingExpenses: Array<{ id: string; category: string; description: string; total: number; amount: number; date: Date; notes: string | null; supplierId: string | null; cashboxId: string | null }>,
): BalanceSheetSection {
  const categoryTotals = new Map<string, number>();
  for (const expense of expenses) {
    const label = normalizeExpenseCategory(expense.category);
    categoryTotals.set(label, (categoryTotals.get(label) || 0) + Number(expense.total || expense.amount || 0));
  }

  const rows = [
    buildRow('EXP-RENT', 'الإيجار', categoryTotals.get('الإيجار') || 0, 'Expense', 'memo', 'memo', 'مصروفات فعلية مدفوعة'),
    buildRow('EXP-ELEC', 'شحن الكهرباء', categoryTotals.get('شحن الكهرباء') || 0, 'Expense', 'memo', 'memo', 'مصروفات فعلية مدفوعة'),
    buildRow('EXP-WAGES', 'الرواتب', categoryTotals.get('الرواتب') || 0, 'Expense', 'memo', 'memo', 'مصروفات فعلية مدفوعة'),
    buildRow('EXP-MAINT', 'مصاريف الصيانة', categoryTotals.get('مصاريف الصيانة') || 0, 'Expense', 'memo', 'memo', 'مصروفات فعلية مدفوعة'),
    buildRow('EXP-COLOR', 'مصاريف ألوان وشحوم', categoryTotals.get('مصاريف ألوان وشحوم') || 0, 'Expense', 'memo', 'memo', 'مصروفات فعلية مدفوعة'),
    buildRow('EXP-PAPER', 'مصاريف أوراق وسوليتب', categoryTotals.get('مصاريف أوراق وسوليتب') || 0, 'Expense', 'memo', 'memo', 'مصروفات فعلية مدفوعة'),
    buildRow(
      'EXP-OTHER',
      'مصاريف / مدفوعات أخرى',
      roundMoney(
        expenses.reduce((s, row) => s + Number(row.total || row.amount || 0), 0) -
        (categoryTotals.get('الإيجار') || 0) -
        (categoryTotals.get('شحن الكهرباء') || 0) -
        (categoryTotals.get('الرواتب') || 0) -
        (categoryTotals.get('مصاريف الصيانة') || 0) -
        (categoryTotals.get('مصاريف ألوان وشحوم') || 0) -
        (categoryTotals.get('مصاريف أوراق وسوليتب') || 0),
      ),
      'Expense',
      'memo',
      'memo',
      'بنود دفع أخرى لا تدخل ضمن التصنيفات المحددة',
    ),
    buildRow('EXP-PEND', 'التزامات مصروفات غير مسددة', roundMoney(pendingExpenses.reduce((s, row) => s + Number(row.total || row.amount || 0), 0)), 'Expense', 'memo', 'memo', 'مصاريف مسجلة ولم تُسدد بعد'),
  ];

  return {
    key: 'expenses',
    title: 'المصروفات والمدفوعات المرتبطة',
    total: roundMoney(rows.reduce((s, row) => s + row.amount, 0)),
    note: 'المدفوعات والتسويات هنا معلومات تشغيلية وتساعد على قراءة أثر المصروفات على الخزنة والالتزامات',
    rows: rows.filter((row) => Math.abs(row.amount) > 0.005),
  };
}

function buildLiabilitiesSection(
  accountTotals: Map<string, { debit: number; credit: number }>,
  accountLookup: Map<string, { code: string; nameAr: string; type: string; subType: string | null }>,
  pendingExpenses: Array<{ id: string; category: string; description: string; total: number; amount: number; date: Date; notes: string | null; supplierId: string | null; cashboxId: string | null }>,
  accruals: Array<{ id: string; accrualNumber: string; type: string; accountCode: string; amount: number; description: string | null; periodStartDate: Date; periodEndDate: Date }>,
  customerSection: BalanceSheetSection,
  supplierSection: BalanceSheetSection,
  liabilityLines: BalanceSheetRow[],
): BalanceSheetSection {
  const rows: BalanceSheetRow[] = [];

  const accountsToShow = ['2011', '2020', '2030', '4030'];
  for (const code of accountsToShow) {
    const balance = getHistoricalAccountBalance(code, accountTotals, accountLookup);
    if (Math.abs(balance) < 0.005) continue;
    const labelMap: Record<string, string> = {
      '2011': 'مستحقات غير مفوترة للموردين',
      '2020': 'قرض قصير الأجل',
      '2030': 'ضريبة المبيعات المستحقة',
      '4030': 'إيراد غير مكتسب / دفعات مقدمة',
    };
    const row = buildRow(`ACC-${code}`, labelMap[code] || code, Math.abs(balance), 'Account', 'liability', 'liability', 'الرصيد الدفتري حتى تاريخ التقرير');
    rows.push(row);
    liabilityLines.push(row);
  }

  const unpaidExpenseTotal = roundMoney(pendingExpenses.reduce((s, row) => s + Number(row.total || row.amount || 0), 0));
  if (unpaidExpenseTotal > 0) {
    const row = buildRow('LIA-EXP', 'مصاريف غير مسددة', unpaidExpenseTotal, 'Expense', 'liability', 'liability', 'التزامات تشغيلية متراكمة');
    rows.push(row);
    liabilityLines.push(row);
  }

  const accrualTotal = roundMoney(accruals.reduce((s, row) => s + Number(row.amount || 0), 0));
  if (accrualTotal > 0) {
    const row = buildRow('LIA-ACCR', 'استحقاقات / مخصصات', accrualTotal, 'Accrual', 'liability', 'liability', 'استحقاقات مسجلة ولم تُسوى بعد');
    rows.push(row);
    liabilityLines.push(row);
  }

  const customerCredit = customerSection.rows.find((row) => row.code === 'CUST-CRED')?.amount || 0;
  if (customerCredit > 0) {
    const row = buildRow('LIA-CUST', 'أرصدة دائنة للعملاء', customerCredit, 'Customers', 'liability', 'liability', 'أموال يجب ردها للعملاء أو رصيد دائن لهم');
    rows.push(row);
    liabilityLines.push(row);
  }

  const supplierPayable = supplierSection.rows.find((row) => row.code === 'SUP-PAY')?.amount || 0;
  if (supplierPayable > 0) {
    const row = buildRow('LIA-SUP', 'مستحقات للموردين', supplierPayable, 'Suppliers', 'liability', 'liability', 'إجمالي ما زال مطلوبًا للموردين');
    rows.push(row);
    liabilityLines.push(row);
  }

  return {
    key: 'liabilities',
    title: 'الخصوم / الالتزامات',
    total: sumRows(rows),
    note: 'الالتزامات تشمل الأرصدة الدائنة الفعلية والديون غير المسددة والاستحقاقات',
    rows,
  };
}

function buildEquitySection(
  accountTotals: Map<string, { debit: number; credit: number }>,
  accountLookup: Map<string, { code: string; nameAr: string; type: string; subType: string | null }>,
  netIncome: number,
  equityLines: BalanceSheetRow[],
): BalanceSheetSection {
  const capitalBalance = getHistoricalAccountBalance('3010', accountTotals, accountLookup);
  const retainedBalance = getHistoricalAccountBalance('3020', accountTotals, accountLookup);

  const rows = [
    buildRow('EQ-CAP', 'رأس المال', capitalBalance, 'Account 3010', 'equity', 'equity', 'الرصيد الدفتري حتى تاريخ التقرير'),
    buildRow('EQ-RET', 'الأرباح المحتجزة', retainedBalance, 'Account 3020', 'equity', 'equity', 'الرصيد الدفتري حتى تاريخ التقرير'),
    buildRow('EQ-NI', 'صافي الربح / الخسارة للفترة', netIncome, 'P&L', 'equity', 'equity', 'حتى تاريخ التقرير'),
  ];

  for (const row of rows) equityLines.push(row);

  return {
    key: 'equity',
    title: 'حقوق الملكية / صافي المركز المالي',
    total: sumRows(rows),
    note: 'المركز المالي يعكس رأس المال والأرباح المحتجزة وصافي الربح حتى تاريخ التقرير',
    rows,
  };
}

function toBalanceMap(
  rows: Array<{ accountCode: string; _sum: { debit: unknown; credit: unknown } }>,
): Map<string, { debit: number; credit: number }> {
  return new Map(rows.map((row) => [
    row.accountCode,
    { debit: Number(row._sum.debit || 0), credit: Number(row._sum.credit || 0) },
  ]));
}

function getHistoricalAccountBalance(
  code: string,
  totals: Map<string, { debit: number; credit: number }>,
  lookup: Map<string, { code: string; nameAr: string; type: string; subType: string | null }>,
): number {
  const totalsRow = totals.get(code);
  if (!totalsRow) return 0;
  const account = lookup.get(code);
  const type = normalizeAccountType(account?.type);
  const isCreditNormal = ['liability', 'equity', 'revenue'].includes(type);
  return roundMoney(isCreditNormal ? totalsRow.credit - totalsRow.debit : totalsRow.debit - totalsRow.credit);
}

function resolveFixedAssetAmount(
  asset: { netBookValue: number; depreciationSchedules: Array<{ period: string; netBookValue: number }>; purchaseDate: Date; disposedAt: Date | null },
  asOfDate: Date,
): number {
  const latestSchedule = asset.depreciationSchedules
    .filter((schedule) => {
      const [year, month] = schedule.period.split('-').map((part) => Number(part));
      if (!year || !month) return false;
      const periodDate = new Date(year, month - 1, 1);
      return periodDate <= asOfDate;
    })
    .at(-1);
  return roundMoney(latestSchedule ? Number(latestSchedule.netBookValue || 0) : Number(asset.netBookValue || 0));
}

function classifyFixedAsset(name: string, description: string | null) {
  const haystack = `${name} ${description || ''}`.toLowerCase();
  if (matchesAny(haystack, FIXED_ASSET_GROUPS[0].keywords)) return FIXED_ASSET_GROUPS[0];
  if (matchesAny(haystack, FIXED_ASSET_GROUPS[1].keywords)) return FIXED_ASSET_GROUPS[1];
  if (matchesAny(haystack, FIXED_ASSET_GROUPS[2].keywords)) return FIXED_ASSET_GROUPS[2];
  if (matchesAny(haystack, FIXED_ASSET_GROUPS[3].keywords)) return FIXED_ASSET_GROUPS[3];
  return FIXED_ASSET_GROUPS[4];
}

function classifyInventoryProduct(type: string) {
  const value = String(type || '').toLowerCase();
  if (value.includes('raw')) return 'raw';
  if (value.includes('finished') || value.includes('product')) return 'finished';
  return 'other';
}

function matchesAny(text: string, keywords: readonly string[]) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function normalizeAccountType(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function normalizeExpenseCategory(value: string) {
  const text = String(value || '').trim();
  if (text in MANUAL_EXPENSE_LABELS) return MANUAL_EXPENSE_LABELS[text];
  return text || 'مصروف آخر';
}

function buildRow(
  code: string,
  label: string,
  amount: number,
  source: string,
  classification: BalanceSheetClassification,
  noteClassification: BalanceSheetClassification,
  note?: string | null,
): BalanceSheetRow {
  return {
    key: `${code}:${label}`,
    code,
    label,
    amount: roundMoney(amount),
    source,
    classification: noteClassification || classification,
    note: note || null,
  };
}

function sumRows(rows: Array<BalanceSheetRow | { amount: number }>) {
  return roundMoney(rows.reduce((total, row) => total + Number(row.amount || 0), 0));
}

function normalizeDate(date: Date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function roundMoney(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function money(value: number) {
  return roundMoney(value).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
