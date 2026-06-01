import { prisma } from './db';

export interface StockItem {
  productId: string;
  quantity: number;
}

export interface BOMItem {
  materialId: string;
  quantity: number;
}

/**
 * Validate stock availability before sales or production
 * Prevents selling more than available stock
 */
export async function validateStockAvailability(items: StockItem[]): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  for (const item of items) {
    const product = await prisma.product.findUnique({
      where: { id: item.productId },
      select: { stock: true, nameAr: true, code: true }
    });

    if (!product) {
      errors.push('المنتج غير موجود');
      continue;
    }

    if (product.stock < item.quantity) {
      errors.push(`الكمية غير متوفرة للمنتج ${product.code} - ${product.nameAr}. المتاح: ${product.stock}، المطلوب: ${item.quantity}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate raw material availability before production
 * Prevents production without enough raw materials
 */
export async function validateRawMaterialAvailability(bomItems: BOMItem[]): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  for (const item of bomItems) {
    const material = await prisma.product.findUnique({
      where: { id: item.materialId },
      select: { stock: true, nameAr: true, code: true }
    });

    if (!material) {
      errors.push('المادة الخام غير موجودة');
      continue;
    }

    if (material.stock < item.quantity) {
      errors.push(`المادة الخام ${material.code} - ${material.nameAr} غير كافية. المتاح: ${material.stock}، المطلوب: ${item.quantity}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate payment amount doesn't exceed remaining balance
 * Prevents overpayment
 */
export async function validatePaymentAmount(invoiceId: string, invoiceType: 'sales' | 'purchase', paymentAmount: number): Promise<{ valid: boolean; error?: string }> {
  if (invoiceType === 'sales') {
    const invoice = await prisma.salesInvoice.findUnique({
      where: { id: invoiceId },
      select: { total: true, grandTotal: true, paidAmount: true, invoiceNumber: true }
    });

    if (!invoice) {
      return { valid: false, error: 'فاتورة البيع غير موجودة' };
    }

    const due       = invoice.grandTotal || invoice.total;
    const remaining = due - invoice.paidAmount;
    if (paymentAmount > remaining + 0.01) {
      return {
        valid: false,
        error: `المبلغ (${paymentAmount}) يتجاوز الرصيد المتبقي (${remaining.toFixed(2)}) للفاتورة ${invoice.invoiceNumber}`,
      };
    }
  } else {
    const invoice = await prisma.purchaseInvoice.findUnique({
      where: { id: invoiceId },
      select: { total: true, grandTotal: true, paidAmount: true, invoiceNumber: true }
    });

    if (!invoice) {
      return { valid: false, error: 'فاتورة الشراء غير موجودة' };
    }

    const due = invoice.grandTotal || invoice.total;
    const remaining = due - invoice.paidAmount;
    if (paymentAmount > remaining + 0.01) {
      return {
        valid: false,
        error: `المبلغ (${paymentAmount}) يتجاوز الرصيد المتبقي (${remaining.toFixed(2)}) للفاتورة ${invoice.invoiceNumber}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Prevent negative stock in all operations
 */
export async function preventNegativeStock(productId: string, quantityChange: number): Promise<{ valid: boolean; error?: string }> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { stock: true, nameAr: true, code: true }
  });

  if (!product) {
    return { valid: false, error: 'المنتج غير موجود' };
  }

  if (product.stock + quantityChange < 0) {
    return { 
      valid: false, 
      error: `لا يمكن تنفيذ العملية لأنها ستجعل مخزون ${product.code} - ${product.nameAr} بالسالب. الرصيد الحالي: ${product.stock}` 
    };
  }

  return { valid: true };
}

/**
 * Validate product type enum values
 */
export function validateProductType(type: string): boolean {
  const validTypes = ['raw_material', 'finished_product'];
  return validTypes.includes(type);
}

/**
 * Validate payment status enum values
 */
export function validatePaymentStatus(status: string): boolean {
  const validStatuses = ['cash', 'credit'];
  return validStatuses.includes(status);
}

/**
 * Validate production order status transitions
 */
export function validateProductionStatusTransition(currentStatus: string, newStatus: string): { valid: boolean; error?: string } {
  const validTransitions: Record<string, string[]> = {
    pending: ['approved', 'cancelled'],
    approved: ['waiting', 'completed', 'cancelled'],
    in_progress: ['completed', 'cancelled'],
    waiting: ['completed', 'cancelled'],
    completed: [],
    cancelled: []
  };

  const allowedTransitions = validTransitions[currentStatus] || [];
  
  if (!allowedTransitions.includes(newStatus)) {
    const labels: Record<string, string> = {
      pending: 'معلّق',
      approved: 'معتمد',
      waiting: 'في الانتظار',
      in_progress: 'قيد التنفيذ',
      completed: 'مكتمل',
      cancelled: 'ملغى',
    };
    const fromLabel = labels[currentStatus] || currentStatus;
    const toLabel = labels[newStatus] || newStatus;
    const allowed = allowedTransitions.map(s => labels[s] || s).join('، ');
    return {
      valid: false,
      error: `لا يمكن نقل أمر الإنتاج من "${fromLabel}" إلى "${toLabel}". الحالات المسموحة: ${allowed || 'لا يوجد'}`
    };
  }

  return { valid: true };
}
