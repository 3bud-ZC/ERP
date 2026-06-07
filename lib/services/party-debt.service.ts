import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getPostingProfile } from '@/lib/services/accounting-posting-profile.service';
import { postJournalLinesInTransaction, type JournalLineDraft } from '@/lib/services/invoice-accounting.service';
import { reverseAllJournalEntriesForReferenceId } from '@/lib/services/journal-reversal.service';
import { recordCashboxTransactionInTx } from '@/lib/services/cashbox.service';

export type PartyType = 'customer' | 'supplier';

export type CustomerOpeningBalanceType = 'customer_owes_us' | 'we_owe_customer' | '';
export type SupplierOpeningBalanceType = 'we_owe_supplier' | 'supplier_owes_us' | '';

export type PartyDebtAction = 'customer_collection' | 'customer_refund' | 'supplier_payment' | 'supplier_refund';

const OPENING_REF = {
  customer: 'CustomerOpeningBalance',
  supplier: 'SupplierOpeningBalance',
} as const;

const DEBT_REF = 'PartyDebtTransaction';
const EQUITY_ACCOUNT = '3020';
const CUSTOMER_CREDIT_ACCOUNT = '4030';
const SUPPLIER_RECEIVABLE_ACCOUNT = '1021';

function normalAmount(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function asDate(value: unknown): Date {
  const d = value ? new Date(String(value)) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function roundMoney(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function openingNet(partyType: PartyType, type?: string | null, amount?: number | null): number {
  const value = normalAmount(amount);
  if (!type || value <= 0) return 0;
  if (partyType === 'customer') {
    if (type === 'customer_owes_us') return value;
    if (type === 'we_owe_customer') return -value;
    return 0;
  }
  if (type === 'we_owe_supplier') return value;
  if (type === 'supplier_owes_us') return -value;
  return 0;
}

function settlementImpact(partyType: PartyType, type: string, amount: number): number {
  if (partyType === 'customer') {
    if (type === 'customer_collection') return -amount;
    if (type === 'customer_refund') return amount;
  }
  if (type === 'supplier_payment') return -amount;
  if (type === 'supplier_refund') return amount;
  return 0;
}

export async function getPartyDebtSummary(partyType: PartyType, partyId: string, tenantId: string) {
  if (partyType === 'customer') return getCustomerDebtSummary(partyId, tenantId);
  return getSupplierDebtSummary(partyId, tenantId);
}

export async function getCustomerDebtSummary(customerId: string, tenantId: string) {
  const [customer, invoices, payments, debtRows] = await Promise.all([
    prisma.customer.findFirst({ where: { id: customerId, tenantId } }),
    prisma.salesInvoice.findMany({
      where: { customerId, tenantId },
      select: { id: true, invoiceNumber: true, date: true, total: true, grandTotal: true, paidAmount: true, paymentStatus: true },
      orderBy: { date: 'asc' },
    }),
    prisma.payment.findMany({
      where: { customerId, tenantId, type: 'incoming' },
      select: { id: true, date: true, amount: true, notes: true },
      orderBy: { date: 'asc' },
    }),
    (prisma as any).partyDebtTransaction.findMany({
      where: { customerId, tenantId },
      orderBy: { date: 'asc' },
    }),
  ]);

  if (!customer) throw new Error('العميل غير موجود');

  const opening = openingNet('customer', (customer as any).openingBalanceType, (customer as any).openingBalanceAmount);
  const invoiceTotal = invoices.reduce((s, inv) => s + Number(inv.grandTotal || inv.total || 0), 0);
  const invoicePaid = invoices.reduce((s, inv) => s + Number(inv.paidAmount || 0), 0);
  const invoiceRemaining = Math.max(0, invoiceTotal - invoicePaid);
  const settlements = debtRows.reduce((s: number, row: any) => s + settlementImpact('customer', row.transactionType, Number(row.amount || 0)), 0);
  const balance = opening + invoiceRemaining + settlements;

  return {
    partyType: 'customer' as const,
    party: customer,
    summary: {
      openingBalance: opening,
      invoiceTotal,
      invoicePaid,
      invoiceRemaining,
      directCollections: debtRows
        .filter((r: any) => r.transactionType === 'customer_collection')
        .reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
      directRefunds: debtRows
        .filter((r: any) => r.transactionType === 'customer_refund')
        .reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
      currentBalance: balance,
      status: balance > 0.01 ? 'مستحق على العميل' : balance < -0.01 ? 'رصيد دائن للعميل' : 'مسدد',
      lastTransactionAt: debtRows.at(-1)?.date ?? payments.at(-1)?.date ?? null,
    },
    transactions: buildCustomerLedgerRows(customer as any, invoices, payments, debtRows),
  };
}

export async function getSupplierDebtSummary(supplierId: string, tenantId: string) {
  const [supplier, invoices, payments, debtRows] = await Promise.all([
    prisma.supplier.findFirst({ where: { id: supplierId, tenantId } }),
    prisma.purchaseInvoice.findMany({
      where: { supplierId, tenantId },
      select: { id: true, invoiceNumber: true, date: true, total: true, grandTotal: true, paidAmount: true, paymentStatus: true },
      orderBy: { date: 'asc' },
    }),
    prisma.payment.findMany({
      where: { supplierId, tenantId, type: 'outgoing' },
      select: { id: true, date: true, amount: true, notes: true },
      orderBy: { date: 'asc' },
    }),
    (prisma as any).partyDebtTransaction.findMany({
      where: { supplierId, tenantId },
      orderBy: { date: 'asc' },
    }),
  ]);

  if (!supplier) throw new Error('المورد غير موجود');

  const opening = openingNet('supplier', (supplier as any).openingBalanceType, (supplier as any).openingBalanceAmount);
  const invoiceTotal = invoices.reduce((s, inv) => s + Number(inv.grandTotal || inv.total || 0), 0);
  const invoicePaid = invoices.reduce((s, inv) => s + Number(inv.paidAmount || 0), 0);
  const invoiceRemaining = Math.max(0, invoiceTotal - invoicePaid);
  const settlements = debtRows.reduce((s: number, row: any) => s + settlementImpact('supplier', row.transactionType, Number(row.amount || 0)), 0);
  const balance = opening + invoiceRemaining + settlements;

  return {
    partyType: 'supplier' as const,
    party: supplier,
    summary: {
      openingBalance: opening,
      invoiceTotal,
      invoicePaid,
      invoiceRemaining,
      directPayments: debtRows
        .filter((r: any) => r.transactionType === 'supplier_payment')
        .reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
      directRefunds: debtRows
        .filter((r: any) => r.transactionType === 'supplier_refund')
        .reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
      currentBalance: balance,
      status: balance > 0.01 ? 'مستحق للمورد' : balance < -0.01 ? 'مستحق لنا عند المورد' : 'مسدد',
      lastTransactionAt: debtRows.at(-1)?.date ?? payments.at(-1)?.date ?? null,
    },
    transactions: buildSupplierLedgerRows(supplier as any, invoices, payments, debtRows),
  };
}

export async function listCustomerBalances(tenantId: string) {
  const customers = await prisma.customer.findMany({ where: { tenantId, isActive: true }, orderBy: { createdAt: 'desc' } });
  const rows = await Promise.all(customers.map(async (customer) => {
    const summary = await getCustomerDebtSummary(customer.id, tenantId);
    return { ...customer, balance: summary.summary.currentBalance, financialStatus: summary.summary.status };
  }));
  return rows;
}

export async function listSupplierBalances(tenantId: string) {
  const suppliers = await prisma.supplier.findMany({ where: { tenantId, isActive: true }, orderBy: { createdAt: 'desc' } });
  const rows = await Promise.all(suppliers.map(async (supplier) => {
    const summary = await getSupplierDebtSummary(supplier.id, tenantId);
    return { ...supplier, balance: summary.summary.currentBalance, financialStatus: summary.summary.status };
  }));
  return rows;
}

export async function setPartyOpeningBalance(params: {
  tx?: Prisma.TransactionClient;
  tenantId: string;
  userId: string;
  partyType: PartyType;
  partyId: string;
  openingBalanceType?: string | null;
  openingBalanceAmount?: number | null;
  openingBalanceDate?: Date | string | null;
}) {
  const run = async (tx: Prisma.TransactionClient) => {
    const amount = normalAmount(params.openingBalanceAmount);
    const type = String(params.openingBalanceType || '').trim();
    const date = asDate(params.openingBalanceDate);
    const refType = OPENING_REF[params.partyType];

    await reverseAllJournalEntriesForReferenceId(tx, params.tenantId, params.partyId, refType);
    await (tx as any).partyDebtTransaction.deleteMany({
      where: {
        tenantId: params.tenantId,
        partyType: params.partyType,
        transactionType: 'opening_balance',
        ...(params.partyType === 'customer' ? { customerId: params.partyId } : { supplierId: params.partyId }),
      },
    });

    const data = {
      openingBalanceType: amount > 0 ? type : null,
      openingBalanceAmount: amount,
      openingBalanceDate: amount > 0 ? date : null,
    };
    if (params.partyType === 'customer') {
      await tx.customer.update({ where: { id: params.partyId }, data });
    } else {
      await tx.supplier.update({ where: { id: params.partyId }, data });
    }

    if (!type || amount <= 0) return null;
    const lines = await buildOpeningLines(tx, params.tenantId, params.partyType, type, amount);
    const journalEntry = await postJournalLinesInTransaction(tx, {
      tenantId: params.tenantId,
      userId: params.userId,
      entryDate: date,
      description: params.partyType === 'customer' ? 'رصيد افتتاحي عميل' : 'رصيد افتتاحي مورد',
      referenceType: refType,
      referenceId: params.partyId,
      lines,
      correlationId: `${params.partyId}:opening`,
    });

    const debtRow = await (tx as any).partyDebtTransaction.create({
      data: {
        partyType: params.partyType,
        ...(params.partyType === 'customer' ? { customerId: params.partyId } : { supplierId: params.partyId }),
        transactionType: 'opening_balance',
        amount,
        date,
        notes: type,
        journalEntryId: journalEntry.id,
        createdBy: params.userId,
        tenantId: params.tenantId,
      },
    });
    return debtRow;
  };

  if (params.tx) return run(params.tx);
  return prisma.$transaction(run, { isolationLevel: 'Serializable', maxWait: 15000, timeout: 30000 });
}

export async function createPartyDebtTransaction(params: {
  tenantId: string;
  userId: string;
  partyType: PartyType;
  partyId: string;
  transactionType: PartyDebtAction;
  amount: number;
  date?: Date | string | null;
  settlementSource: 'cashbox' | 'bank';
  cashboxId?: string | null;
  settlementAccountCode?: string | null;
  notes?: string | null;
}) {
  const amount = normalAmount(params.amount);
  if (amount <= 0) throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  if (params.settlementSource === 'cashbox' && !params.cashboxId) throw new Error('يجب اختيار الخزنة');

  return prisma.$transaction(async (tx) => {
    const partyExists = params.partyType === 'customer'
      ? await tx.customer.findFirst({ where: { id: params.partyId, tenantId: params.tenantId }, select: { id: true, nameAr: true } })
      : await tx.supplier.findFirst({ where: { id: params.partyId, tenantId: params.tenantId }, select: { id: true, nameAr: true } });
    if (!partyExists) throw new Error(params.partyType === 'customer' ? 'العميل غير موجود' : 'المورد غير موجود');

    const currentBalance = await getCurrentPartyBalanceInTx(tx, params.partyType, params.partyId, params.tenantId);
    const requiredDirection = expectedBalanceDirection(params.transactionType);
    if (requiredDirection === 'positive' && currentBalance <= 0.01) {
      throw new Error('لا يوجد رصيد مستحق صالح لهذه الحركة');
    }
    if (requiredDirection === 'negative' && currentBalance >= -0.01) {
      throw new Error('لا يوجد رصيد عكسي صالح لهذه الحركة');
    }
    if (amount - Math.abs(currentBalance) > 0.01) {
      throw new Error(`المبلغ يتجاوز الرصيد القابل للتسوية (${Math.abs(roundMoney(currentBalance)).toFixed(2)})`);
    }

    const date = asDate(params.date);
    const direction = cashboxDirection(params.transactionType);
    const row = await (tx as any).partyDebtTransaction.create({
      data: {
        partyType: params.partyType,
        ...(params.partyType === 'customer' ? { customerId: params.partyId } : { supplierId: params.partyId }),
        transactionType: params.transactionType,
        amount,
        date,
        cashboxId: params.settlementSource === 'cashbox' ? params.cashboxId : null,
        notes: params.notes || null,
        createdBy: params.userId,
        tenantId: params.tenantId,
      },
    });

    if (params.settlementSource === 'cashbox') {
      await recordCashboxTransactionInTx(tx, {
        tenantId: params.tenantId,
        cashboxId: params.cashboxId!,
        type: params.transactionType,
        direction,
        amount,
        date,
        referenceType: DEBT_REF,
        referenceId: row.id,
        description: params.notes || debtActionLabel(params.transactionType),
        createdBy: params.userId,
      });
    }

    const lines = await buildSettlementLines(
      tx,
      params.tenantId,
      params.transactionType,
      amount,
      params.settlementSource,
      params.settlementAccountCode,
    );
    const journalEntry = await postJournalLinesInTransaction(tx, {
      tenantId: params.tenantId,
      userId: params.userId,
      entryDate: date,
      description: debtActionLabel(params.transactionType),
      referenceType: DEBT_REF,
      referenceId: row.id,
      lines,
      correlationId: `${row.id}:post`,
    });

    return (tx as any).partyDebtTransaction.update({
      where: { id: row.id },
      data: { journalEntryId: journalEntry.id },
    });
  }, { isolationLevel: 'Serializable', maxWait: 15000, timeout: 30000 });
}

async function getCurrentPartyBalanceInTx(
  tx: Prisma.TransactionClient,
  partyType: PartyType,
  partyId: string,
  tenantId: string,
) {
  if (partyType === 'customer') {
    const [customer, invoices, debtRows] = await Promise.all([
      tx.customer.findFirst({
        where: { id: partyId, tenantId },
        select: { openingBalanceType: true, openingBalanceAmount: true },
      }),
      tx.salesInvoice.aggregate({
        where: { tenantId, customerId: partyId },
        _sum: { total: true, grandTotal: true, paidAmount: true },
      }),
      (tx as any).partyDebtTransaction.findMany({
        where: { tenantId, customerId: partyId },
        select: { transactionType: true, amount: true },
      }),
    ]);
    const opening = openingNet('customer', customer?.openingBalanceType, customer?.openingBalanceAmount as number | null | undefined);
    const gross = Number(invoices._sum.grandTotal || invoices._sum.total || 0);
    const paid = Number(invoices._sum.paidAmount || 0);
    const settlements = debtRows.reduce((s: number, row: any) => s + settlementImpact('customer', row.transactionType, Number(row.amount || 0)), 0);
    return roundMoney(opening + Math.max(0, gross - paid) + settlements);
  }

  const [supplier, invoices, debtRows] = await Promise.all([
    tx.supplier.findFirst({
      where: { id: partyId, tenantId },
      select: { openingBalanceType: true, openingBalanceAmount: true },
    }),
    tx.purchaseInvoice.aggregate({
      where: { tenantId, supplierId: partyId },
      _sum: { total: true, grandTotal: true, paidAmount: true },
    }),
    (tx as any).partyDebtTransaction.findMany({
      where: { tenantId, supplierId: partyId },
      select: { transactionType: true, amount: true },
    }),
  ]);
  const opening = openingNet('supplier', supplier?.openingBalanceType, supplier?.openingBalanceAmount as number | null | undefined);
  const gross = Number(invoices._sum.grandTotal || invoices._sum.total || 0);
  const paid = Number(invoices._sum.paidAmount || 0);
  const settlements = debtRows.reduce((s: number, row: any) => s + settlementImpact('supplier', row.transactionType, Number(row.amount || 0)), 0);
  return roundMoney(opening + Math.max(0, gross - paid) + settlements);
}

function expectedBalanceDirection(type: PartyDebtAction): 'positive' | 'negative' {
  return type === 'customer_collection' || type === 'supplier_payment' ? 'positive' : 'negative';
}

async function buildOpeningLines(tx: Prisma.TransactionClient, tenantId: string, partyType: PartyType, type: string, amount: number): Promise<JournalLineDraft[]> {
  const profile = await getPostingProfile(tenantId);
  await ensureOperationalAccounts(tx, tenantId);

  if (partyType === 'customer' && type === 'customer_owes_us') {
    return [
      line(profile.ar, amount, 0, 'رصيد افتتاحي مدين للعميل', tenantId),
      line(EQUITY_ACCOUNT, 0, amount, 'مقابل رصيد افتتاحي عميل', tenantId),
    ];
  }
  if (partyType === 'customer' && type === 'we_owe_customer') {
    return [
      line(EQUITY_ACCOUNT, amount, 0, 'مقابل رصيد دائن للعميل', tenantId),
      line(CUSTOMER_CREDIT_ACCOUNT, 0, amount, 'رصيد دائن للعميل', tenantId),
    ];
  }
  if (partyType === 'supplier' && type === 'we_owe_supplier') {
    return [
      line(EQUITY_ACCOUNT, amount, 0, 'مقابل رصيد افتتاحي مورد', tenantId),
      line(profile.ap, 0, amount, 'رصيد افتتاحي دائن للمورد', tenantId),
    ];
  }
  if (partyType === 'supplier' && type === 'supplier_owes_us') {
    return [
      line(SUPPLIER_RECEIVABLE_ACCOUNT, amount, 0, 'رصيد مدين على المورد', tenantId),
      line(EQUITY_ACCOUNT, 0, amount, 'مقابل رصيد مدين على المورد', tenantId),
    ];
  }
  throw new Error('نوع الرصيد الافتتاحي غير صالح');
}

async function buildSettlementLines(
  tx: Prisma.TransactionClient,
  tenantId: string,
  type: PartyDebtAction,
  amount: number,
  settlementSource: 'cashbox' | 'bank',
  settlementAccountCode?: string | null,
): Promise<JournalLineDraft[]> {
  const profile = await getPostingProfile(tenantId);
  await ensureOperationalAccounts(tx, tenantId);
  const settlementAccount = settlementSource === 'bank'
    ? String(settlementAccountCode || '1010')
    : profile.cash;

  switch (type) {
    case 'customer_collection':
      return [
        line(settlementAccount, amount, 0, settlementSource === 'bank' ? 'تحصيل بنكي من عميل' : 'تحصيل من عميل', tenantId),
        line(profile.ar, 0, amount, 'تخفيض مديونية عميل', tenantId),
      ];
    case 'customer_refund':
      return [
        line(CUSTOMER_CREDIT_ACCOUNT, amount, 0, 'سداد رصيد دائن لعميل', tenantId),
        line(settlementAccount, 0, amount, settlementSource === 'bank' ? 'تحويل بنكي للعميل' : 'صرف نقدية للعميل', tenantId),
      ];
    case 'supplier_payment':
      return [
        line(profile.ap, amount, 0, 'سداد مستحقات مورد', tenantId),
        line(settlementAccount, 0, amount, settlementSource === 'bank' ? 'تحويل بنكي للمورد' : 'صرف نقدية للمورد', tenantId),
      ];
    case 'supplier_refund':
      return [
        line(settlementAccount, amount, 0, settlementSource === 'bank' ? 'تحصيل بنكي من مورد' : 'تحصيل من مورد', tenantId),
        line(SUPPLIER_RECEIVABLE_ACCOUNT, 0, amount, 'تخفيض رصيد مدين على المورد', tenantId),
      ];
  }
}

function line(accountCode: string, debit: number, credit: number, description: string, tenantId: string): JournalLineDraft {
  return { accountCode, debit, credit, description, tenantId };
}

async function ensureOperationalAccounts(tx: Prisma.TransactionClient, tenantId: string) {
  const accounts = [
    { code: EQUITY_ACCOUNT, nameAr: 'الأرباح المحتفظ بها', nameEn: 'Retained Earnings', type: 'Equity', subType: 'Retained' },
    { code: CUSTOMER_CREDIT_ACCOUNT, nameAr: 'أرصدة دائنة للعملاء', nameEn: 'Customer Credit Balances', type: 'Liability', subType: 'CustomerCredit' },
    { code: SUPPLIER_RECEIVABLE_ACCOUNT, nameAr: 'أرصدة مدينة على الموردين', nameEn: 'Supplier Debit Balances', type: 'Asset', subType: 'SupplierReceivable' },
  ];
  for (const acc of accounts) {
    await tx.account.upsert({
      where: { tenantId_code: { tenantId, code: acc.code } },
      update: {},
      create: { ...acc, isActive: true, tenantId },
    });
  }
}

function cashboxDirection(type: PartyDebtAction): 'in' | 'out' {
  return type === 'customer_collection' || type === 'supplier_refund' ? 'in' : 'out';
}

export function debtActionLabel(type: string): string {
  const labels: Record<string, string> = {
    opening_balance: 'رصيد افتتاحي',
    customer_collection: 'تحصيل مديونية من عميل',
    customer_refund: 'سداد رصيد دائن لعميل',
    supplier_payment: 'سداد مديونية لمورد',
    supplier_refund: 'تحصيل رصيد من مورد',
  };
  return labels[type] || type;
}

function buildCustomerLedgerRows(customer: any, invoices: any[], payments: any[], debtRows: any[]) {
  const rows: any[] = [];
  const opening = normalAmount(customer.openingBalanceAmount);
  if (opening > 0) {
    rows.push({
      id: `opening:${customer.id}`,
      date: customer.openingBalanceDate || customer.createdAt,
      type: 'opening_balance',
      label: 'رصيد افتتاحي',
      debit: customer.openingBalanceType === 'customer_owes_us' ? opening : 0,
      credit: customer.openingBalanceType === 'we_owe_customer' ? opening : 0,
      notes: customer.openingBalanceType,
    });
  }
  invoices.forEach(inv => rows.push({
    id: `invoice:${inv.id}`,
    date: inv.date,
    type: 'sales_invoice',
    label: `فاتورة مبيعات ${inv.invoiceNumber}`,
    debit: Number(inv.grandTotal || inv.total || 0),
    credit: 0,
    notes: inv.paymentStatus,
  }));
  payments.forEach(payment => rows.push({
    id: `payment:${payment.id}`,
    date: payment.date,
    type: 'invoice_payment',
    label: 'تحصيل فاتورة',
    debit: 0,
    credit: Number(payment.amount || 0),
    notes: payment.notes,
  }));
  debtRows.filter((r: any) => r.transactionType !== 'opening_balance').forEach((row: any) => rows.push({
    id: `debt:${row.id}`,
    date: row.date,
    type: row.transactionType,
    label: debtActionLabel(row.transactionType),
    debit: row.transactionType === 'customer_refund' ? Number(row.amount || 0) : 0,
    credit: row.transactionType === 'customer_collection' ? Number(row.amount || 0) : 0,
    notes: row.notes,
  }));
  return withRunningBalance(rows, 'debit');
}

function buildSupplierLedgerRows(supplier: any, invoices: any[], payments: any[], debtRows: any[]) {
  const rows: any[] = [];
  const opening = normalAmount(supplier.openingBalanceAmount);
  if (opening > 0) {
    rows.push({
      id: `opening:${supplier.id}`,
      date: supplier.openingBalanceDate || supplier.createdAt,
      type: 'opening_balance',
      label: 'رصيد افتتاحي',
      debit: supplier.openingBalanceType === 'supplier_owes_us' ? opening : 0,
      credit: supplier.openingBalanceType === 'we_owe_supplier' ? opening : 0,
      notes: supplier.openingBalanceType,
    });
  }
  invoices.forEach(inv => rows.push({
    id: `invoice:${inv.id}`,
    date: inv.date,
    type: 'purchase_invoice',
    label: `فاتورة مشتريات ${inv.invoiceNumber}`,
    debit: 0,
    credit: Number(inv.grandTotal || inv.total || 0),
    notes: inv.paymentStatus,
  }));
  payments.forEach(payment => rows.push({
    id: `payment:${payment.id}`,
    date: payment.date,
    type: 'invoice_payment',
    label: 'سداد فاتورة',
    debit: Number(payment.amount || 0),
    credit: 0,
    notes: payment.notes,
  }));
  debtRows.filter((r: any) => r.transactionType !== 'opening_balance').forEach((row: any) => rows.push({
    id: `debt:${row.id}`,
    date: row.date,
    type: row.transactionType,
    label: debtActionLabel(row.transactionType),
    debit: row.transactionType === 'supplier_payment' ? Number(row.amount || 0) : 0,
    credit: row.transactionType === 'supplier_refund' ? Number(row.amount || 0) : 0,
    notes: row.notes,
  }));
  return withRunningBalance(rows, 'credit');
}

function withRunningBalance(rows: any[], normalSide: 'debit' | 'credit') {
  let balance = 0;
  return rows
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((row) => {
      balance += normalSide === 'debit'
        ? Number(row.debit || 0) - Number(row.credit || 0)
        : Number(row.credit || 0) - Number(row.debit || 0);
      return { ...row, balance };
    });
}
