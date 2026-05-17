import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { getAuthenticatedUser, checkPermission } from '@/lib/auth';
import { getCustomerBalance, getSupplierBalance } from '@/lib/services/party-balance.service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'view_accounting') && !checkPermission(user, 'read_sales_invoice')) {
      return apiError('ليس لديك صلاحية', 403);
    }
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);

    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');
    const supplierId = searchParams.get('supplierId');

    if (customerId) {
      const balance = await getCustomerBalance(user.tenantId, customerId);
      return apiSuccess(balance, 'Customer balance fetched');
    }
    if (supplierId) {
      const balance = await getSupplierBalance(user.tenantId, supplierId);
      return apiSuccess(balance, 'Supplier balance fetched');
    }

    return apiError('customerId or supplierId required', 400);
  } catch (error) {
    return handleApiError(error, 'Fetch party balance');
  }
}
