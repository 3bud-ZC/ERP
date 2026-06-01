import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { logAuditAction, getAuthenticatedUser, checkPermission } from '@/lib/auth';
import { validatePaymentAmount } from '@/lib/validation';
import {
  executeCreatePayment,
  executeUpdatePayment,
  executeDeletePayment,
  executeReversePayment,
  PaymentExecutionError,
} from '@/lib/services/payment-execution.service';
import { logActivity } from '@/lib/activity-log';

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);

    const { searchParams } = new URL(request.url);
    const where: Record<string, unknown> = { tenantId: user.tenantId };
    if (searchParams.get('customerId')) where.customerId = searchParams.get('customerId');
    if (searchParams.get('supplierId')) where.supplierId = searchParams.get('supplierId');
    if (searchParams.get('salesInvoiceId')) where.salesInvoiceId = searchParams.get('salesInvoiceId');
    if (searchParams.get('purchaseInvoiceId')) where.purchaseInvoiceId = searchParams.get('purchaseInvoiceId');
    if (searchParams.get('type')) where.type = searchParams.get('type');

    const payments = await prisma.payment.findMany({
      where,
      include: {
        customer: { select: { id: true, code: true, nameAr: true } },
        supplier: { select: { id: true, code: true, nameAr: true } },
        salesInvoice: { select: { id: true, invoiceNumber: true, total: true } },
        purchaseInvoice: { select: { id: true, invoiceNumber: true, total: true } },
        cashbox: { select: { id: true, code: true, name: true, currentBalance: true } },
        allocations: true,
      },
      orderBy: { date: 'desc' },
    });

    return apiSuccess(payments, 'Payments fetched successfully');
  } catch (error) {
    return handleApiError(error, 'Fetch payments');
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);

    const body = await request.json();
    const { amount, date, type, customerId, supplierId, salesInvoiceId, purchaseInvoiceId, cashboxId, notes, allocations } =
      body;

    if (!amount || Number(amount) <= 0) return apiError('المبلغ مطلوب', 400);
    if (!type || (type !== 'incoming' && type !== 'outgoing')) {
      return apiError('نوع الدفع غير صالح', 400);
    }
    if (!cashboxId) return apiError('يجب اختيار الخزنة عند تسجيل مبلغ مدفوع', 400);

    if (salesInvoiceId) {
      const v = await validatePaymentAmount(salesInvoiceId, 'sales', Number(amount));
      if (!v.valid) return apiError(v.error || 'المبلغ يتجاوز الرصيد', 400);
    }
    if (purchaseInvoiceId) {
      const v = await validatePaymentAmount(purchaseInvoiceId, 'purchase', Number(amount));
      if (!v.valid) return apiError(v.error || 'المبلغ يتجاوز الرصيد', 400);
    }

    const result = await executeCreatePayment({
      tenantId: user.tenantId,
      userId: user.id,
      amount: Number(amount),
      date: new Date(date),
      type,
      customerId,
      supplierId,
      salesInvoiceId,
      purchaseInvoiceId,
      cashboxId,
      notes,
      allocations,
    });

    await logAuditAction(
      user.id,
      'CREATE',
      'financials',
      'Payment',
      result.payment.id,
      { payment: result.payment },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined,
    );

    await logActivity({
      entity: 'Payment',
      entityId: result.payment.id,
      action: 'CREATE',
      userId: user.id,
      after: result.payment,
    });

    return apiSuccess(result.payment, 'تم تسجيل الدفعة بنجاح');
  } catch (error) {
    if (error instanceof PaymentExecutionError) return apiError(error.message, 400);
    return handleApiError(error, 'Create payment');
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);

    const body = await request.json();
    const { id, amount, date, type, notes, allocations, cashboxId, reverse } = body;

    if (!id) return apiError('معرف الدفع مطلوب', 400);

    if (reverse === true) {
      const result = await executeReversePayment({
        tenantId: user.tenantId,
        userId: user.id,
        paymentId: id,
      });
      return apiSuccess(result.payment, 'تم عكس الدفعة');
    }

    const result = await executeUpdatePayment({
      tenantId: user.tenantId,
      userId: user.id,
      paymentId: id,
      amount: amount != null ? Number(amount) : undefined,
      date: date ? new Date(date) : undefined,
      type,
      notes,
      allocations,
      cashboxId,
    });

    await logAuditAction(
      user.id,
      'UPDATE',
      'financials',
      'Payment',
      id,
      { payment: result.payment },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined,
    );

    return apiSuccess(result.payment, 'تم تحديث الدفعة بنجاح');
  } catch (error) {
    if (error instanceof PaymentExecutionError) return apiError(error.message, 400);
    return handleApiError(error, 'Update payment');
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return apiError('معرف الدفع مطلوب', 400);

    await executeDeletePayment({
      tenantId: user.tenantId,
      userId: user.id,
      paymentId: id,
    });

    await logAuditAction(
      user.id,
      'DELETE',
      'financials',
      'Payment',
      id,
      undefined,
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined,
    );

    return apiSuccess({ id }, 'Payment deleted successfully');
  } catch (error) {
    if (error instanceof PaymentExecutionError) return apiError(error.message, 400);
    return handleApiError(error, 'Delete payment');
  }
}
