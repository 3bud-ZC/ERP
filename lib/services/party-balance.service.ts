/**
 * Customer / supplier balance from invoices, payments, and returns.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { invoiceAmountDue } from '@/lib/utils/invoice-tax';

export interface PartyBalanceSummary {
  partyId: string;
  partyType: 'customer' | 'supplier';
  invoiceCount: number;
  totalInvoiced: number;
  totalPaid: number;
  totalReturns: number;
  balanceDue: number;
  overdueCount: number;
}

function isOverdue(dueDate: Date | null, paymentStatus: string): boolean {
  if (paymentStatus === 'paid') return false;
  if (!dueDate) return false;
  return dueDate < new Date(new Date().setHours(0, 0, 0, 0));
}

export async function getCustomerBalance(
  tenantId: string,
  customerId: string,
): Promise<PartyBalanceSummary> {
  const invoices = await prisma.salesInvoice.findMany({
    where: { tenantId, customerId, status: { not: 'draft' } },
    select: {
      grandTotal: true,
      total: true,
      paidAmount: true,
      paymentStatus: true,
      paymentTermsDays: true,
      date: true,
    },
  });

  const returns = await prisma.salesReturn.aggregate({
    where: { tenantId, customerId, status: 'approved' },
    _sum: { total: true },
  });

  let totalInvoiced = 0;
  let totalPaid = 0;
  let overdueCount = 0;

  for (const inv of invoices) {
    const due = inv.grandTotal || inv.total;
    totalInvoiced += due;
    totalPaid += inv.paidAmount;
    const dueDate = new Date(inv.date);
    dueDate.setDate(dueDate.getDate() + (inv.paymentTermsDays ?? 0));
    if (isOverdue(dueDate, inv.paymentStatus)) overdueCount++;
  }

  const totalReturns = returns._sum.total ?? 0;
  const balanceDue = Math.max(0, totalInvoiced - totalPaid - totalReturns);

  return {
    partyId: customerId,
    partyType: 'customer',
    invoiceCount: invoices.length,
    totalInvoiced,
    totalPaid,
    totalReturns,
    balanceDue,
    overdueCount,
  };
}

export async function getSupplierBalance(
  tenantId: string,
  supplierId: string,
): Promise<PartyBalanceSummary> {
  const invoices = await prisma.purchaseInvoice.findMany({
    where: { tenantId, supplierId, status: { not: 'draft' } },
    select: {
      grandTotal: true,
      total: true,
      paidAmount: true,
      paymentStatus: true,
      paymentTermsDays: true,
      date: true,
    },
  });

  const returns = await prisma.purchaseReturn.aggregate({
    where: { tenantId, supplierId, status: 'approved' },
    _sum: { total: true },
  });

  let totalInvoiced = 0;
  let totalPaid = 0;
  let overdueCount = 0;

  for (const inv of invoices) {
    const due = inv.grandTotal || inv.total;
    totalInvoiced += due;
    totalPaid += inv.paidAmount;
    const dueDate = new Date(inv.date);
    dueDate.setDate(dueDate.getDate() + (inv.paymentTermsDays ?? 0));
    if (isOverdue(dueDate, inv.paymentStatus)) overdueCount++;
  }

  const totalReturns = returns._sum.total ?? 0;
  const balanceDue = Math.max(0, totalInvoiced - totalPaid - totalReturns);

  return {
    partyId: supplierId,
    partyType: 'supplier',
    invoiceCount: invoices.length,
    totalInvoiced,
    totalPaid,
    totalReturns,
    balanceDue,
    overdueCount,
  };
}

export async function getInvoiceOutstandingInTx(
  tx: Prisma.TransactionClient,
  invoiceType: 'sales' | 'purchase',
  invoiceId: string,
): Promise<number> {
  if (invoiceType === 'sales') {
    const inv = await tx.salesInvoice.findUnique({
      where: { id: invoiceId },
      select: { grandTotal: true, total: true, paidAmount: true },
    });
    if (!inv) return 0;
    return invoiceAmountDue(inv.grandTotal || inv.total, inv.paidAmount);
  }
  const inv = await tx.purchaseInvoice.findUnique({
    where: { id: invoiceId },
    select: { grandTotal: true, total: true, paidAmount: true },
  });
  if (!inv) return 0;
  return invoiceAmountDue(inv.grandTotal || inv.total, inv.paidAmount);
}

export async function getInvoiceOutstanding(
  invoiceType: 'sales' | 'purchase',
  invoiceId: string,
): Promise<number> {
  if (invoiceType === 'sales') {
    const inv = await prisma.salesInvoice.findUnique({
      where: { id: invoiceId },
      select: { grandTotal: true, total: true, paidAmount: true },
    });
    if (!inv) return 0;
    return invoiceAmountDue(inv.grandTotal || inv.total, inv.paidAmount);
  }
  const inv = await prisma.purchaseInvoice.findUnique({
    where: { id: invoiceId },
    select: { grandTotal: true, total: true, paidAmount: true },
  });
  if (!inv) return 0;
  return invoiceAmountDue(inv.grandTotal || inv.total, inv.paidAmount);
}
