import { prisma } from '@/lib/db';
import { purchaseInvoiceRepo } from '@/lib/repositories/purchase-invoice.repo';

// Disable caching for real-time data
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import {
  reverseJournalEntry,
  createPurchaseInvoiceEntry,
  postJournalEntry,
} from '@/lib/accounting';
import { dualRunCompare, dualRunCompareById } from '@/lib/domain/accounting/dual-run';
import { createInventoryTransaction } from '@/lib/inventory-transactions';
import {
  executeCreatePurchaseInvoice,
  executeUpdatePurchaseInvoice,
  executeCancelPurchaseInvoice,
  executeDeletePurchaseInvoice,
  InvoiceExecutionError,
  mapExecutionError,
} from '@/lib/services/invoice-execution.service';
import { mapExecutionItems } from '@/lib/utils/map-execution-items';
import { recordAuditTrail } from '@/lib/services/audit-trail.service';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { logAuditAction, getAuthenticatedUser, checkPermission } from '@/lib/auth';
import { logActivity } from '@/lib/activity-log';
import { resolveInvoiceNumber } from '@/lib/invoice-numbering';

/**
 * Coerce a raw value into a full ISO-8601 datetime string suitable for
 * Prisma's `DateTime` field. The browser's native <input type="date">
 * sends `"YYYY-MM-DD"` which Prisma rejects with
 *   "Invalid value for argument `date`: premature end of input.
 *    Expected ISO-8601 DateTime."
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
function translatePurchaseError(error: any): string {
  const msg: string = error?.message || String(error);
  if (msg.includes('Foreign key') || msg.includes('foreign key') || msg.includes('P2003')) return 'هذا العنصر مرتبط ببيانات أخرى';
  if (msg.includes('Unique constraint') || msg.includes('P2002')) return 'رقم الفاتورة مستخدم بالفعل';
  if (msg.includes('Validation') || msg.includes('validation') || msg.includes('P2000')) return 'بيانات غير مكتملة أو غير صحيحة';
  if (msg.includes('Record to update not found') || msg.includes('P2025')) return 'السجل غير موجود';
  return 'حدث خطأ غير متوقع — يرجى المحاولة مرة أخرى';
}

// GET - Read purchase invoices (requires read_purchase_invoice permission)
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
      const invoice = await purchaseInvoiceRepo.findByIdAndTenant(id, user.tenantId);
      if (!invoice) return apiError('الفاتورة غير موجودة', 404);
      return apiSuccess(invoice, 'Purchase invoice fetched successfully');
    }

    const invoices = await purchaseInvoiceRepo.listByTenant(user.tenantId);
    return apiSuccess(invoices, 'Purchase invoices fetched successfully');
  } catch (error) {
    return handleApiError(error, 'Fetch purchase invoices');
  }
}

// POST - Create purchase invoice (requires create_purchase_invoice permission)
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }

    if (!checkPermission(user, 'create_purchase_invoice')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const body = await request.json();
      const { items, tenantId: _clientTenantId, ...invoiceData } = body;
      // Normalize date fields (form sends "YYYY-MM-DD"; Prisma needs ISO-8601).
      normalizeInvoiceDates(invoiceData);

      // Explicit input validation
      if (!invoiceData.supplierId) {
        return apiError('يجب اختيار المورد', 400);
      }
      if (!Array.isArray(items) || items.length === 0) {
        return apiError('يجب إضافة صنف واحد على الأقل', 400);
      }
      for (const item of items) {
        if (!item.productId) return apiError('كل صنف يجب أن يحتوي على منتج محدد', 400);
        if (Number(item.quantity) <= 0) return apiError('الكمية يجب أن تكون أكبر من صفر', 400);
        if (Number(item.price) < 0) return apiError('السعر يجب أن يكون صحيحاً', 400);
      }

      delete invoiceData.discountPercent;

      const invoiceNumber = await resolveInvoiceNumber(
        invoiceData.invoiceNumber,
        'PI',
        user.tenantId!,
      );

      const result = await executeCreatePurchaseInvoice({
        invoiceData: {
          invoiceNumber,
          date: invoiceData.date ? new Date(invoiceData.date) : new Date(),
          supplierId: invoiceData.supplierId,
          notes: invoiceData.notes,
          status: invoiceData.status,
          paymentStatus: invoiceData.paymentStatus,
          paidAmount: invoiceData.paidAmount,
          paymentTermsDays: invoiceData.paymentTermsDays,
          issueDate: invoiceData.issueDate ? new Date(invoiceData.issueDate) : undefined,
          purchaseRepId: invoiceData.purchaseRepId,
          currency: invoiceData.currency,
          template: invoiceData.template,
          discount: invoiceData.discount,
          discountPercent: body.discountPercent,
          taxRate: invoiceData.taxRate ?? body.taxRate,
          tax: invoiceData.tax,
          extraCharges: body.extraCharges,
          freightAmount: body.freightAmount,
          taxMode: body.taxMode,
        },
        items: items.map((item: {
          productId: string;
          quantity: number;
          price: number;
          unitCost?: number;
          discountPercent?: number;
          taxRate?: number;
          description?: string;
        }) => ({
          productId: item.productId,
          quantity: Number(item.quantity),
          price: Number(item.price),
          unitCost: item.unitCost ?? Number(item.price),
          discountPercent: item.discountPercent,
          taxRate: item.taxRate,
          description: item.description,
        })),
        tenantId: user.tenantId!,
        userId: user.id,
      });

      const invoice = result.invoice;
      if (result.journalEntry?.id) {
        await dualRunCompareById('PurchaseInvoice:POST', result.journalEntry.id);
      }

      // Log audit action
      await logAuditAction(
        user.id,
        'CREATE',
        'purchases',
        'PurchaseInvoice',
        invoice.id,
        { invoice },
        request.headers.get('x-forwarded-for') || undefined,
        request.headers.get('user-agent') || undefined
      );

      // Log activity for audit trail
      await logActivity({
        entity: 'PurchaseInvoice',
        entityId: invoice.id,
        action: 'CREATE',
        userId: user.id,
        after: invoice,
      });

      return apiSuccess(invoice, 'Purchase invoice created successfully');
    } catch (error: any) {
      console.error('[purchase-invoices:POST] failed', error);
      if (error instanceof InvoiceExecutionError) {
        const status = error.code === 'INVENTORY_FAILED' ? 409 : error.code === 'VALIDATION_FAILED' ? 400 : 500;
        return apiError(error.message, status);
      }
      const msg = translatePurchaseError(error);
      return apiError(msg, 500);
    }
  }

// PUT — canonical update with reverse + republish (Phase 5B).
export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'update_purchase_invoice')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const body = await request.json();
    const { id: bodyId, items: rawItems, discountPercent, taxRate, taxMode, extraCharges, freightAmount, ...invoiceData } = body;
    const queryId = new URL(request.url).searchParams.get('id');
    const id = bodyId || queryId;
    if (!id) return apiError('Invoice ID missing', 400);

    normalizeInvoiceDates(invoiceData);

    const existingInvoice = await prisma.purchaseInvoice.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { items: true },
    });
    if (!existingInvoice) return apiError('الفاتورة غير موجودة', 404);

    if (invoiceData.status === 'cancelled') {
      const cancelResult = await executeCancelPurchaseInvoice({
        invoiceId: id,
        tenantId: user.tenantId,
        userId: user.id,
      });
      await recordAuditTrail({
        userId: user.id,
        tenantId: user.tenantId,
        module: 'purchases',
        entity: 'PurchaseInvoice',
        entityId: id,
        action: 'CANCEL',
        before: existingInvoice,
        after: cancelResult.invoice,
        ip: request.headers.get('x-forwarded-for') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      });
      return apiSuccess(cancelResult.invoice, 'تم إلغاء الفاتورة');
    }

    const items = mapExecutionItems(rawItems ?? []).map(it => ({
      ...it,
      unitCost: it.unitCost ?? it.price,
    }));
    if (items.length === 0) {
      return apiError('يجب أن تحتوي الفاتورة على صنف واحد على الأقل', 400);
    }

    try {
      const result = await executeUpdatePurchaseInvoice({
        invoiceId: id,
        tenantId: user.tenantId,
        userId: user.id,
        invoiceData: {
          supplierId: invoiceData.supplierId,
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
          freightAmount,
          taxMode,
        },
        items,
        republish: true,
      });

      await recordAuditTrail({
        userId: user.id,
        tenantId: user.tenantId,
        module: 'purchases',
        entity: 'PurchaseInvoice',
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
    return handleApiError(error, 'Update purchase invoice');
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'delete_purchase_invoice')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return apiError('معرف الفاتورة مطلوب', 400);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    try {
      const result = await executeDeletePurchaseInvoice({
        invoiceId: id,
        tenantId: user.tenantId,
        userId: user.id,
      });

      await logAuditAction(
        user.id,
        'DELETE',
        'purchases',
        'PurchaseInvoice',
        id,
        undefined,
        request.headers.get('x-forwarded-for') || undefined,
        request.headers.get('user-agent') || undefined,
      );
      await logActivity({
        entity: 'PurchaseInvoice',
        entityId: id,
        action: 'DELETE',
        userId: user.id,
        before: result.invoice,
      });

      return apiSuccess({ id }, 'Purchase invoice deleted successfully');
    } catch (error) {
      if (error instanceof InvoiceExecutionError) {
        const mapped = mapExecutionError(error);
        return apiError(mapped.body.error, mapped.status, mapped.body);
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Delete purchase invoice');
  }
}
