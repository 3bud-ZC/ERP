import { prisma } from '@/lib/db';
import { salesInvoiceRepo } from '@/lib/repositories/sales-invoice.repo';

// Disable caching for real-time data
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { validateStockAvailability } from '@/lib/inventory';
import { dualRunCompare, dualRunCompareById } from '@/lib/domain/accounting/dual-run';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { logAuditAction, getAuthenticatedUser, checkPermission } from '@/lib/auth';
import { logActivity } from '@/lib/activity-log';
import {
  executeCreateSalesInvoice,
  executeUpdateSalesInvoice,
  executeCancelSalesInvoice,
  executeDeleteInvoice,
  InvoiceExecutionError,
  mapExecutionError,
} from '@/lib/services/invoice-execution.service';
import { mapExecutionItems } from '@/lib/utils/map-execution-items';
import { recordAuditTrail } from '@/lib/services/audit-trail.service';
import { resolveInvoiceNumber } from '@/lib/invoice-numbering';

/**
 * Coerce a raw value into a full ISO-8601 datetime string suitable for
 * Prisma's `DateTime` field. The browser's native <input type="date">
 * sends `"YYYY-MM-DD"` which Prisma rejects with
 *   "Invalid value for argument `date`: premature end of input.
 *    Expected ISO-8601 DateTime."
 * We accept date-only, full ISO strings, and Date objects.
 */
function toISODateTime(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** Mutate an invoice payload in-place to normalize all DateTime fields. */
function normalizeInvoiceDates(data: Record<string, any>): Record<string, any> {
  if ('date' in data)      data.date      = toISODateTime(data.date);
  if ('issueDate' in data) data.issueDate = toISODateTime(data.issueDate);
  if ('dueDate' in data)   data.dueDate   = toISODateTime(data.dueDate);
  return data;
}

// Translate backend errors to user-friendly Arabic messages
function translateSalesError(error: any): string {
  const msg: string = error?.message || String(error);
  if (msg.includes('INVOICE_FAILED')) return 'فشل إنشاء الفاتورة';
  if (msg.includes('INVENTORY_FAILED')) return 'فشل تحديث المخزون';
  if (msg.includes('ACCOUNTING_FAILED')) return 'فشل إنشاء القيود المحاسبية';
  if (msg.includes('VALIDATION_FAILED')) return 'بيانات الفاتورة غير صحيحة';
  if (msg.includes('must have at least one item')) return 'يجب إضافة صنف واحد على الأقل';
  if (msg.includes('amount must equal payment amount')) return 'إجمالي توزيعات الدفع لا يساوي مبلغ الدفع';
  if (msg.includes('must be linked to at least one invoice')) return 'يجب ربط الدفعة بفاتورة واحدة على الأقل';
  if (msg.includes('paid amount cannot exceed') || msg.includes('cannot exceed')) return 'المبلغ المدفوع لا يمكن أن يتجاوز إجمالي الفاتورة';
  if (msg.includes('must choose cashbox') || msg.includes('cashbox')) return 'يجب اختيار الخزنة عند تسجيل مبلغ مدفوع';
  if (msg.includes('customer') && msg.includes('not found')) return 'العميل غير موجود أو لا يتبع هذا الحساب';
  if (msg.includes('product') && msg.includes('not found')) return 'يوجد صنف غير موجود أو غير تابع للحساب';
  if (msg.includes('Account') || msg.includes('account code')) return 'دليل الحسابات غير مكتمل لهذا الحساب الجديد. أعد إنشاء الحساب أو تواصل مع الإدارة.';
  if (msg.includes('posting') || msg.includes('journal')) return 'تعذر ترحيل القيد المحاسبي. تحقق من إعدادات الحسابات.';
  if (msg.includes('Foreign key') || msg.includes('foreign key') || msg.includes('P2003')) return 'هذا العنصر مرتبط ببيانات أخرى';
  if (msg.includes('Unique constraint') || msg.includes('P2002')) return 'رقم الفاتورة مستخدم بالفعل';
  if (msg.includes('Stock') || msg.includes('stock') || msg.includes('insufficient')) return 'رصيد المخزون غير كافٍ';
  if (msg.includes('Validation') || msg.includes('validation') || msg.includes('P2000')) return 'بيانات غير مكتملة أو غير صحيحة';
  if (msg.includes('Record to update not found') || msg.includes('P2025')) return 'السجل غير موجود';
  return 'فشل إنشاء الفاتورة — يرجى المحاولة مرة أخرى';
}

// GET - Read sales invoices (requires read_sales_invoice permission)
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }

    if (!user.tenantId) {
      return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    // Single invoice by id
    if (id) {
      const invoice = await salesInvoiceRepo.findByIdAndTenant(id, user.tenantId);
      if (!invoice) return apiError('الفاتورة غير موجودة', 404);
      return apiSuccess(invoice, 'Sales invoice fetched successfully');
    }

    const invoices = await salesInvoiceRepo.listByTenant(user.tenantId);
    return apiSuccess(invoices, 'Sales invoices fetched successfully');
  } catch (error) {
    return handleApiError(error, 'Fetch sales invoices');
  }
}

// POST - Create sales invoice (requires create_sales_invoice permission)
export async function POST(request: Request) {
  const requestId = `[SalesInvoice-${Date.now()}]`;
  
  try {
    console.log(`${requestId} ✓ Request started`);
    
    // ========================================================================
    // STEP 1: Authentication & Authorization
    // ========================================================================
    const user = await getAuthenticatedUser(request);
    if (!user) {
      console.log(`${requestId} ✗ Not authenticated`);
      return apiError('لم يتم المصادقة', 401);
    }

    if (!checkPermission(user, 'create_sales_invoice')) {
      console.log(`${requestId} ✗ No permission for user ${user.id}`);
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    console.log(`${requestId} ✓ Auth passed for user ${user.id}, tenant ${user.tenantId}`);

    // ========================================================================
    // STEP 2: Parse Request Body
    // ========================================================================
    let body;
    try {
      body = await request.json();
      console.log(`${requestId} ✓ Request parsed`, { itemsCount: body.items?.length });
    } catch (parseErr) {
      console.log(`${requestId} ✗ Failed to parse request body`, parseErr);
      return apiError('بيانات الطلب غير صحيحة', 400);
    }

    const { items, ...invoiceData } = body;
    const { tenantId: _clientTenantId, ...safeInvoiceData } = invoiceData;
    const initialPaidAmount = Number(safeInvoiceData.paidAmount || 0);
    const cashboxId = safeInvoiceData.cashboxId ? String(safeInvoiceData.cashboxId) : '';
    const paymentStatus = String(safeInvoiceData.paymentStatus || '').trim().toLowerCase();
    const requiresCashbox = initialPaidAmount > 0 || paymentStatus === 'cash' || paymentStatus === 'paid';
    // Normalize all DateTime fields (date, issueDate, dueDate) — see helper.
    normalizeInvoiceDates(safeInvoiceData);

    // ========================================================================
    // STEP 3: Tenant Validation
    // ========================================================================
    if (!user.tenantId) {
      console.log(`${requestId} ✗ No tenant assigned to user`);
      return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    }

    // ========================================================================
    // STEP 4: Input Validation (Strict)
    // ========================================================================
    console.log(`${requestId} → Validating inputs...`);
    
    if (!safeInvoiceData.customerId) {
      console.log(`${requestId} ✗ Validation failed: no customerId`);
      return apiError('يجب اختيار العميل', 400);
    }

    if (!Array.isArray(items) || items.length === 0) {
      console.log(`${requestId} ✗ Validation failed: items not array or empty`);
      return apiError('يجب إضافة صنف واحد على الأقل', 400);
    }

    // Validate each item
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.productId) {
        console.log(`${requestId} ✗ Validation failed: item ${i} missing productId`);
        return apiError('كل صنف يجب أن يحتوي على منتج محدد', 400);
      }
      if (!item.quantity || Number(item.quantity) <= 0) {
        console.log(`${requestId} ✗ Validation failed: item ${i} invalid quantity`, item.quantity);
        return apiError('الكمية يجب أن تكون أكبر من صفر', 400);
      }
      if (item.price == null || Number(item.price) < 0) {
        console.log(`${requestId} ✗ Validation failed: item ${i} invalid price`, item.price);
        return apiError('السعر يجب أن يكون صحيحاً', 400);
      }
    }

    console.log(`${requestId} ✓ All inputs valid`);
    if (initialPaidAmount < 0) return apiError('المبلغ المدفوع لا يمكن أن يكون أقل من صفر', 400);
    if (requiresCashbox && !cashboxId) {
      return apiError('يجب اختيار الخزنة عند تسجيل مبلغ مدفوع', 400);
    }

    // ========================================================================
    // STEP 5: Verify Customer Exists in Tenant
    // ========================================================================
    console.log(`${requestId} → Checking customer exists...`);
    let customerExists = false;
    try {
      const customer = await (prisma as any).customer.findFirst({
        where: { id: safeInvoiceData.customerId, tenantId: user.tenantId },
        select: { id: true },
      });
      customerExists = !!customer;
      if (!customerExists) {
        console.log(`${requestId} ✗ Customer ${safeInvoiceData.customerId} not found`);
        return apiError('العميل المختار غير موجود', 404);
      }
      console.log(`${requestId} ✓ Customer verified`);
    } catch (custErr) {
      console.log(`${requestId} ✗ Error verifying customer`, custErr);
      return apiError('خطأ في التحقق من العميل', 500);
    }

    // ========================================================================
    // STEP 6: Stock Availability Check
    // ========================================================================
    console.log(`${requestId} → Checking stock availability...`);
    let validation;
    try {
      validation = await validateStockAvailability(items, user.tenantId);
      if (!validation.valid) {
        console.log(`${requestId} ✗ Stock check failed`, validation.errors);
        return apiError(
          'رصيد المخزون غير كافٍ لأحد المنتجات أو أكثر',
          409,
          { details: validation.errors }
        );
      }
      console.log(`${requestId} ✓ Stock available`);
    } catch (stockErr) {
      console.log(`${requestId} ✗ Stock validation error`, stockErr);
      return apiError('خطأ في التحقق من المخزون', 500);
    }

    // ========================================================================
    // STEP 7: Create Invoice Atomically
    // ========================================================================
    console.log(`${requestId} → Creating invoice atomically...`);
    let invoice;
    try {
      // Resolve a clean, sequential, per-tenant invoice number (INV-YYYY-NNNNNN).
      // If the user typed a custom number, we keep it.
      const invoiceNumber = await resolveInvoiceNumber(
        safeInvoiceData.invoiceNumber,
        'INV',
        user.tenantId,
      );

      const result = await executeCreateSalesInvoice({
        invoiceData: {
          invoiceNumber,
          date: safeInvoiceData.date ? new Date(safeInvoiceData.date) : new Date(),
          customerId: safeInvoiceData.customerId,
          notes: safeInvoiceData.notes,
          status: safeInvoiceData.status,
          paymentStatus: safeInvoiceData.paymentStatus,
          paidAmount: safeInvoiceData.paidAmount,
          cashboxId,
          paymentTermsDays: safeInvoiceData.paymentTermsDays,
          issueDate: safeInvoiceData.issueDate ? new Date(safeInvoiceData.issueDate) : undefined,
          salesRepId: safeInvoiceData.salesRepId,
          currency: safeInvoiceData.currency,
          template: safeInvoiceData.template,
          salesOrderId: safeInvoiceData.salesOrderId,
          discount: safeInvoiceData.discount,
          discountPercent: body.discountPercent,
          taxRate: safeInvoiceData.taxRate ?? body.taxRate,
          tax: safeInvoiceData.tax,
          extraCharges: body.extraCharges,
          taxMode: body.taxMode,
        },
        items: items.map((item: {
          productId: string;
          quantity: number;
          price: number;
          discountPercent?: number;
          taxRate?: number;
          description?: string;
          warehouseId?: string | null;
        }) => ({
          productId: item.productId,
          quantity: Number(item.quantity),
          price: Number(item.price),
          warehouseId: item.warehouseId,
          discountPercent: item.discountPercent,
          taxRate: item.taxRate,
          description: item.description,
        })),
        tenantId: user.tenantId,
        userId: user.id,
      });
      invoice = result.invoice;
      console.log(`${requestId} ✓ Invoice created: ${invoice.id}`);
      // Phase 1 dual-run: validate atomic-service journal entry against new domain engine
      await dualRunCompareById('SalesInvoice:POST', (result as any)?.journalEntry?.id);
    } catch (txnErr: any) {
      console.error(`${requestId} ✗ Invoice creation transaction failed:`, txnErr);
      if (txnErr instanceof InvoiceExecutionError) {
        const status = txnErr.code === 'INVENTORY_FAILED' ? 409 : txnErr.code === 'VALIDATION_FAILED' ? 400 : 500;
        return apiError(txnErr.message, status);
      }
      const txnMsg = translateSalesError(txnErr);
      return apiError(txnMsg || 'فشل إنشاء الفاتورة', 500);
    }

    // ========================================================================
    // STEP 8: Log Audit (Non-Critical)
    // ========================================================================
    console.log(`${requestId} → Logging audit action...`);
    try {
      await logAuditAction(
        user.id,
        'CREATE',
        'sales',
        'SalesInvoice',
        invoice.id,
        { invoice },
        request.headers.get('x-forwarded-for') || undefined,
        request.headers.get('user-agent') || undefined
      );
      console.log(`${requestId} ✓ Audit logged`);
    } catch (auditErr) {
      console.error(`${requestId} ! Audit logging failed (non-critical):`, auditErr);
      // Do NOT fail if audit fails
    }

    // ========================================================================
    // STEP 9: Log Activity (Non-Critical)
    // ========================================================================
    console.log(`${requestId} → Logging activity...`);
    try {
      await logActivity({
        entity: 'SalesInvoice',
        entityId: invoice.id,
        action: 'CREATE',
        userId: user.id,
        after: invoice,
      });
      console.log(`${requestId} ✓ Activity logged`);
    } catch (actErr) {
      console.error(`${requestId} ! Activity logging failed (non-critical):`, actErr);
      // Do NOT fail if activity fails
    }

    console.log(`${requestId} ✓✓✓ SUCCESS - Invoice saved with ID: ${invoice.id}`);
    return apiSuccess(invoice, 'تم حفظ الفاتورة بنجاح');
    
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.error(`[SalesInvoice-ERROR] Unexpected error in POST:`, msg);
    const translatedMsg = translateSalesError(error);
    return apiError(translatedMsg || 'فشل إنشاء الفاتورة', 500);
  }
}

// PUT — canonical update: reverse + republish stock/GL atomically (Phase 5B).
export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'update_sales_invoice')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const body = await request.json();
    const { id: bodyId, items: rawItems, discountPercent, taxRate, taxMode, extraCharges, ...invoiceData } = body;
    const queryId = new URL(request.url).searchParams.get('id');
    const id = bodyId || queryId;
    if (!id) return apiError('Invoice ID missing', 400);

    normalizeInvoiceDates(invoiceData);

    const existingInvoice = await prisma.salesInvoice.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { items: true },
    });
    if (!existingInvoice) return apiError('Invoice not found or unauthorized', 404);

    if (invoiceData.status === 'cancelled') {
      const cancelResult = await executeCancelSalesInvoice({
        invoiceId: id,
        tenantId: user.tenantId,
        userId: user.id,
      });
      await recordAuditTrail({
        userId: user.id,
        tenantId: user.tenantId,
        module: 'sales',
        entity: 'SalesInvoice',
        entityId: id,
        action: 'CANCEL',
        before: existingInvoice,
        after: cancelResult.invoice,
        ip: request.headers.get('x-forwarded-for') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      });
      return apiSuccess(cancelResult.invoice, 'تم إلغاء الفاتورة');
    }

    const items = mapExecutionItems(rawItems ?? []);
    if (items.length === 0) {
      return apiError('يجب أن تحتوي الفاتورة على صنف واحد على الأقل', 400);
    }

    const validation = await validateStockAvailability(items, user.tenantId);
    if (!validation.valid) {
      return apiError('رصيد المخزون غير كافٍ', 409, { details: validation.errors });
    }

    try {
      const result = await executeUpdateSalesInvoice({
        invoiceId: id,
        tenantId: user.tenantId,
        userId: user.id,
        invoiceData: {
          customerId: invoiceData.customerId,
          date: invoiceData.date ? new Date(invoiceData.date) : undefined,
          notes: invoiceData.notes,
          status: invoiceData.status,
          paymentStatus: invoiceData.paymentStatus,
          paidAmount: invoiceData.paidAmount,
          discount: invoiceData.discount,
          discountPercent,
          taxRate: invoiceData.taxRate ?? taxRate,
          tax: invoiceData.tax,
          extraCharges,
          taxMode,
        },
        items,
        republish: true,
      });

      await recordAuditTrail({
        userId: user.id,
        tenantId: user.tenantId,
        module: 'sales',
        entity: 'SalesInvoice',
        entityId: id,
        action: result.republished ? 'POST' : 'UPDATE',
        before: existingInvoice,
        after: result.invoice,
        ip: request.headers.get('x-forwarded-for') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
        metadata: { republished: result.republished },
      });

      return apiSuccess(
        { ...result.invoice, republished: result.republished },
        result.republished ? 'تم تحديث الفاتورة وإعادة ترحيلها' : 'تم تحديث الفاتورة',
      );
    } catch (error) {
      if (error instanceof InvoiceExecutionError) {
        const mapped = mapExecutionError(error);
        return apiError(mapped.body.error, mapped.status, mapped.body);
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Update sales invoice');
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'delete_sales_invoice')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return apiError('Invoice ID missing', 400);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    try {
      const result = await executeDeleteInvoice({
        invoiceId: id,
        tenantId: user.tenantId,
        userId: user.id,
        invoiceType: 'sales',
      });

      await logAuditAction(
        user.id,
        'DELETE',
        'sales',
        'SalesInvoice',
        id,
        undefined,
        request.headers.get('x-forwarded-for') || undefined,
        request.headers.get('user-agent') || undefined,
      );
      await logActivity({
        entity: 'SalesInvoice',
        entityId: id,
        action: 'DELETE',
        userId: user.id,
        before: result.invoice,
      });

      return apiSuccess({ id }, 'Sales invoice deleted successfully');
    } catch (error) {
      if (error instanceof InvoiceExecutionError) {
        const mapped = mapExecutionError(error);
        return apiError(mapped.body.error, mapped.status, mapped.body);
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Delete sales invoice');
  }
}
