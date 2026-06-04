import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';
import { hasReportAccess } from '@/lib/reports/report-access';
import { buildWasteReportData, type WasteReportSource } from '@/lib/reports/waste-report';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseDate(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function endOfDay(date: Date) {
  const normalized = new Date(date);
  normalized.setHours(23, 59, 59, 999);
  return normalized;
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    if (!hasReportAccess(user, 'waste')) {
      return apiError('ليس لديك صلاحية لعرض تقرير الفاقد', 403);
    }

    const { searchParams } = new URL(request.url);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const fromDate = parseDate(searchParams.get('fromDate'), monthStart);
    const toDate = endOfDay(parseDate(searchParams.get('toDate'), now));
    const productId = searchParams.get('productId') || undefined;
    const source = (searchParams.get('source') || 'all') as WasteReportSource;

    const data = await buildWasteReportData({
      tenantId: user.tenantId,
      fromDate,
      toDate,
      productId,
      source,
    });

    return apiSuccess(data, 'تم جلب تقرير الفاقد بنجاح');
  } catch (error) {
    return handleApiError(error, 'Waste report');
  }
}
