import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';
import { hasReportAccess } from '@/lib/reports/report-access';
import { buildBalanceSheetData } from '@/lib/reports/balance-sheet';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر', 400);
    if (!hasReportAccess(user, 'balance-sheet')) return apiError('ليس لديك صلاحية لعرض تقرير الميزانية العمومية', 403);

    const { searchParams } = new URL(request.url);
    const asOfDate = searchParams.get('asOfDate')
      ? new Date(searchParams.get('asOfDate')! + 'T23:59:59.999')
      : new Date();

    const data = await buildBalanceSheetData(user.tenantId, asOfDate);
    return apiSuccess(data, 'تم جلب تقرير الميزانية العمومية بنجاح');
  } catch (error) {
    return handleApiError(error, 'Balance sheet report');
  }
}
