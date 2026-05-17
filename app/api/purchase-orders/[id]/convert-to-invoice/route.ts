import { prisma } from '@/lib/db';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { getAuthenticatedUser, checkPermission, logAuditAction } from '@/lib/auth';
import { reversePurchaseOrderJournalEntry } from '@/lib/accounting';
import { resolveInvoiceNumber } from '@/lib/invoice-numbering';
import {
  executeCreatePurchaseInvoice,
  InvoiceExecutionError,
  mapExecutionError,
} from '@/lib/services/invoice-execution.service';
import { recordAuditTrail } from '@/lib/services/audit-trail.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** POST — full PO → invoice via canonical execution. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'create_purchase_invoice')) return apiError('ليس لديك صلاحية', 403);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);

    const { id } = params;

    const purchaseOrder = await prisma.purchaseOrder.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { supplier: true, items: { include: { product: true } } },
    });

    if (!purchaseOrder) return apiError('Purchase order not found', 404);

    const invoiceItems = purchaseOrder.items.map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price,
      unitCost: item.price,
    }));

    const invoiceNumber = await resolveInvoiceNumber(null, 'PINV', user.tenantId);

    try {
      const result = await executeCreatePurchaseInvoice({
        invoiceData: {
          invoiceNumber,
          date: new Date(),
          supplierId: purchaseOrder.supplierId,
          notes: purchaseOrder.notes ?? undefined,
          status: 'posted',
          paymentStatus: 'unpaid',
        },
        items: invoiceItems,
        tenantId: user.tenantId,
        userId: user.id,
      });

      await reversePurchaseOrderJournalEntry(purchaseOrder.id, user.id);

      await prisma.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: { status: 'invoiced' },
      });

      await recordAuditTrail({
        userId: user.id,
        tenantId: user.tenantId,
        module: 'purchases',
        entity: 'PurchaseOrder',
        entityId: purchaseOrder.id,
        action: 'CONVERT',
        after: { invoiceId: result.invoice.id, invoiceNumber },
        ip: request.headers.get('x-forwarded-for') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      });

      await logAuditAction(
        user.id,
        'CREATE',
        'purchases',
        'PurchaseInvoice',
        result.invoice.id,
        { fromPurchaseOrder: purchaseOrder.id },
        request.headers.get('x-forwarded-for') || undefined,
        request.headers.get('user-agent') || undefined,
      );

      return apiSuccess(result.invoice, 'تم تحويل أمر الشراء إلى فاتورة');
    } catch (error) {
      if (error instanceof InvoiceExecutionError) {
        const mapped = mapExecutionError(error);
        return apiError(mapped.body.error, mapped.status, mapped.body);
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Convert purchase order to invoice');
  }
}
