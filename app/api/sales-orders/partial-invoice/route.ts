import { prisma } from '@/lib/db';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { getAuthenticatedUser, checkPermission, logAuditAction } from '@/lib/auth';
import { transitionEntity } from '@/lib/workflow-engine';
import { registerAllEventHandlers } from '@/lib/event-handlers';
import { resolveInvoiceNumber } from '@/lib/invoice-numbering';
import { executeCreateSalesInvoice, InvoiceExecutionError } from '@/lib/services/invoice-execution.service';

registerAllEventHandlers();

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** POST — partial invoice from sales order via canonical execution flow. */
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'manage_sales')) return apiError('ليس لديك صلاحية', 403);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);

    const body = await request.json();
    const { salesOrderId, items, taxRate, discountPercent } = body;

    if (!salesOrderId || !items || !Array.isArray(items)) {
      return apiError('Sales order ID and items array are required', 400);
    }

    const salesOrder = await (prisma as any).salesOrder.findFirst({
      where: { id: salesOrderId, tenantId: user.tenantId },
      include: { customer: true, items: true },
    });

    if (!salesOrder) return apiError('Sales order not found', 404);

    const invoiceItems: Array<{
      productId: string;
      quantity: number;
      price: number;
      description?: string;
    }> = [];

    for (const item of items) {
      const orderItem = salesOrder.items.find((oi: { id: string }) => oi.id === item.salesOrderItemId);
      if (!orderItem) {
        return apiError(`Order item ${item.salesOrderItemId} not found`, 404);
      }

      const remaining = orderItem.quantity - (orderItem.invoicedQuantity ?? 0);
      const quantityToInvoice = Math.min(Number(item.quantityToInvoice) || 0, remaining);
      if (quantityToInvoice <= 0) {
        return apiError(`Invalid quantity to invoice for item ${item.salesOrderItemId}`, 400);
      }

      invoiceItems.push({
        productId: orderItem.productId,
        quantity: quantityToInvoice,
        price: orderItem.price,
        description: orderItem.description,
      });
    }

    const invoiceNumber = await resolveInvoiceNumber(null, 'INV', user.tenantId);

    const result = await executeCreateSalesInvoice({
      invoiceData: {
        invoiceNumber,
        date: new Date(),
        customerId: salesOrder.customerId,
        salesOrderId: salesOrder.id,
        status: 'posted',
        paymentStatus: 'unpaid',
        discount: salesOrder.discount,
        discountPercent,
        taxRate,
      },
      items: invoiceItems,
      tenantId: user.tenantId,
      userId: user.id,
    });

    for (const item of items) {
      const orderItem = salesOrder.items.find((oi: { id: string }) => oi.id === item.salesOrderItemId);
      if (!orderItem) continue;
      const quantityToInvoice = Math.min(
        Number(item.quantityToInvoice) || 0,
        orderItem.quantity - (orderItem.invoicedQuantity ?? 0),
      );
      const newInvoiced = (orderItem.invoicedQuantity ?? 0) + quantityToInvoice;
      await (prisma as any).salesOrderItem.update({
        where: { id: item.salesOrderItemId },
        data: {
          invoicedQuantity: newInvoiced,
          remainingQuantity: orderItem.quantity - newInvoiced,
          fulfillmentStatus: newInvoiced >= orderItem.quantity ? 'fulfilled' : 'partially_fulfilled',
        },
      });
    }

    await logAuditAction(
      user.id,
      'CREATE',
      'sales',
      'SalesInvoice',
      result.invoice.id,
      { invoice: result.invoice, salesOrderId },
    );

    return apiSuccess(result.invoice, 'Partial invoice created successfully');
  } catch (error) {
    if (error instanceof InvoiceExecutionError) {
      return apiError(error.message, error.code === 'INVENTORY_FAILED' ? 409 : 400);
    }
    return handleApiError(error, 'Create partial invoice');
  }
}
