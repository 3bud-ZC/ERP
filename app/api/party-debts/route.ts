import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser, checkPermission } from '@/lib/auth';
import {
  createPartyDebtTransaction,
  getPartyDebtSummary,
  type PartyDebtAction,
  type PartyType,
} from '@/lib/services/party-debt.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parsePartyType(value: string | null): PartyType | null {
  if (value === 'customer' || value === 'supplier') return value;
  return null;
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    if (!checkPermission(user, 'view_accounting')) return apiError('ليس لديك صلاحية', 403);

    const { searchParams } = new URL(request.url);
    const partyType = parsePartyType(searchParams.get('partyType'));
    const partyId = searchParams.get('partyId') || '';
    if (!partyType) return apiError('نوع الطرف غير صالح', 400);
    if (!partyId) return apiError('معرف الطرف مطلوب', 400);

    const summary = await getPartyDebtSummary(partyType, partyId, user.tenantId);
    return apiSuccess(summary, 'تم جلب بيانات المديونية');
  } catch (error) {
    return handleApiError(error, 'Party debt summary');
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    if (!checkPermission(user, 'manage_accounting')) return apiError('ليس لديك صلاحية', 403);

    const body = await request.json().catch(() => ({}));
    const partyType = parsePartyType(String(body.partyType || ''));
    const partyId = String(body.partyId || '').trim();
    const transactionType = String(body.transactionType || '').trim() as PartyDebtAction;
    const amount = Number(body.amount);
    const cashboxId = String(body.cashboxId || '').trim();
    const settlementSource = String(body.settlementSource || 'cashbox').trim() === 'bank' ? 'bank' : 'cashbox';
    const settlementAccountCode = body.settlementAccountCode ? String(body.settlementAccountCode).trim() : null;
    const date = body.date ? new Date(body.date) : new Date();
    const notes = body.notes ? String(body.notes).trim() : null;

    if (!partyType) return apiError('نوع الطرف غير صالح', 400);
    if (!partyId) return apiError('معرف الطرف مطلوب', 400);
    if (!['customer_collection', 'customer_refund', 'supplier_payment', 'supplier_refund'].includes(transactionType)) {
      return apiError('نوع حركة المديونية غير صالح', 400);
    }
    if (partyType === 'customer' && !transactionType.startsWith('customer_')) {
      return apiError('نوع الحركة لا يناسب العميل', 400);
    }
    if (partyType === 'supplier' && !transactionType.startsWith('supplier_')) {
      return apiError('نوع الحركة لا يناسب المورد', 400);
    }
    if (!Number.isFinite(amount) || amount <= 0) return apiError('المبلغ يجب أن يكون أكبر من صفر', 400);
    if (settlementSource === 'cashbox' && !cashboxId) return apiError('يجب اختيار الخزنة', 400);
    if (Number.isNaN(date.getTime())) return apiError('التاريخ غير صالح', 400);

    const row = await createPartyDebtTransaction({
      tenantId: user.tenantId,
      userId: user.id,
      partyType,
      partyId,
      transactionType,
      amount,
      settlementSource,
      cashboxId,
      settlementAccountCode,
      date,
      notes,
    });

    return apiSuccess(row, 'تم تسجيل حركة المديونية بنجاح');
  } catch (error) {
    return handleApiError(error, 'Create party debt transaction');
  }
}
