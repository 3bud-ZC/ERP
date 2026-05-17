import { prisma } from '@/lib/db';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { getAuthenticatedUser, checkPermission, logAuditAction } from '@/lib/auth';
import { resolveInvoiceNumber } from '@/lib/invoice-numbering';
import {
  executeCreateSalesInvoice,
  InvoiceExecutionError,
  mapExecutionError,
} from '@/lib/services/invoice-execution.service';
import { recordAuditTrail } from '@/lib/services/audit-trail.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** POST — full SO → invoice via canonical execution (stock + GL + costing). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'create_sales_invoice')) return apiError('ليس لديك صلاحية', 403);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);

    const { id } = params;

    const salesOrder = await prisma.salesOrder.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        customer: true,
        items: { include: { product: true } },
        salesInvoices: { select: { id: true } },
      },
    });

    if (!salesOrder) return apiError('Sales order not found', 404);

    if (salesOrder.salesInvoices && salesOrder.salesInvoices.length > 0) {
      return apiError('Sales order already has invoices', 400);
    }

    const invoiceItems = salesOrder.items.map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price,
    }));

    const invoiceNumber = await resolveInvoiceNumber(null, 'INV', user.tenantId);

    try {
      const result = await executeCreateSalesInvoice({
        invoiceData: {
          invoiceNumber,
          date: new Date(),
          customerId: salesOrder.customerId,
          salesOrderId: salesOrder.id,
          notes: salesOrder.notes ?? undefined,
          status: 'posted',
          paymentStatus: 'unpaid',
          discount: salesOrder.discount ?? undefined,
          tax: salesOrder.tax > 0 ? salesOrder.tax : undefined,
        },
        items: invoiceItems,
        tenantId: user.tenantId,
        userId: user.id,
      });

      await prisma.salesOrder.update({
        where: { id: salesOrder.id },
        data: { status: 'invoiced' },
      });

      await recordAuditTrail({
        userId: user.id,
        tenantId: user.tenantId,
        module: 'sales',
        entity: 'SalesOrder',
        entityId: salesOrder.id,
        action: 'CONVERT',
        after: { invoiceId: result.invoice.id, invoiceNumber },
        ip: request.headers.get('x-forwarded-for') || undefined,
        userAgent: request.headers.get('user-agent') || undefined,
      });

      await logAuditAction(
        user.id,
        'CREATE',
        'sales',
        'SalesInvoice',
        result.invoice.id,
        { fromSalesOrder: salesOrder.id, salesOrderNumber: salesOrder.orderNumber },
        request.headers.get('x-forwarded-for') || undefined,
        request.headers.get('user-agent') || undefined,
      );

      return apiSuccess(result.invoice, 'تم تحويل أمر البيع إلى فاتورة');
    } catch (error) {
      if (error instanceof InvoiceExecutionError) {
        const mapped = mapExecutionError(error);
        return apiError(mapped.body.error, mapped.status, mapped.body);
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error, 'Convert sales order to invoice');
  }
}
